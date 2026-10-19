import { preparar, evaluar } from "./ejecutor.js";

const CONFIG = window.REPASO_CONFIG || {};
const WORKER_URL = (CONFIG.workerUrl || "").replace(/\/+$/, "");
const CON_IA = Boolean(WORKER_URL);
const CLAVE = "repaso-tc1037-v2";

const vista = document.getElementById("vista");
const marcadorPuntos = document.getElementById("puntos");
const avisoPuntos = document.getElementById("aviso-puntos");

let datos = null;
const pasos = {};
const resultados = {};

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
  agregar(nodo, hijos);
  return nodo;
}

function agregar(nodo, hijos) {
  for (const hijo of hijos.flat(Infinity)) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    nodo.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
}

function reemplazar(nodo, ...hijos) {
  nodo.replaceChildren();
  agregar(nodo, hijos);
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

// ---------- progreso y puntos ----------

const estado = Object.assign({ quiz: {}, ej: {}, pistas: {} }, almacen.leer("estado", {}));

function guardarEstado() {
  almacen.guardar("estado", estado);
  pintarPuntos();
}

function nivelDe(ejercicio) {
  return datos.niveles.find((n) => n.id === ejercicio.nivel);
}

function valorActual(ejercicio) {
  return Math.max(1, nivelDe(ejercicio).puntos - (estado.pistas[ejercicio.id] || 0));
}

function aciertosQuiz() {
  return datos.quiz.filter((q) => estado.quiz[q.id] === q.correcta).length;
}

function ejerciciosResueltos() {
  return datos.ejercicios.filter((e) => estado.ej[e.id] !== undefined).length;
}

function puntosTotales() {
  return aciertosQuiz() + Object.values(estado.ej).reduce((suma, p) => suma + p, 0);
}

function pintarPuntos() {
  if (datos) marcadorPuntos.textContent = `★ ${puntosTotales()}`;
}

function celebrar(puntos) {
  avisoPuntos.textContent = `+${puntos} ★`;
  avisoPuntos.classList.add("visible");
  setTimeout(() => avisoPuntos.classList.remove("visible"), 1600);
}

function siguientePendiente() {
  const pregunta = datos.quiz.findIndex((q) => estado.quiz[q.id] === undefined);
  if (pregunta >= 0) return `#/quiz/${pregunta + 1}`;
  const ejercicio = datos.ejercicios.find((e) => estado.ej[e.id] === undefined);
  return ejercicio ? `#/ej/${ejercicio.id}` : "#/";
}

function ir(ruta) {
  if (location.hash === ruta) mostrar();
  else location.hash = ruta;
}

// ---------- piezas comunes ----------

function barraAcciones(...botones) {
  return el("div", { class: "acciones" }, el("div", { class: "acciones__contenido" }, botones));
}

function boton(texto, alClic, clase = "") {
  return el("button", { type: "button", class: `boton ${clase}`.trim(), onclick: alClic }, texto);
}

function consolaEjemplo(ejemplo) {
  return el(
    "pre",
    { class: "codigo", "aria-label": "Ejemplo de ejecución" },
    ejemplo.entradas.map((entrada) => [el("span", { class: "prompt" }, ">>> "), `${entrada}\n`]),
    ejemplo.salida.join("\n"),
  );
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

function clienteId() {
  let id = almacen.leer("cliente", null);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
    almacen.guardar("cliente", id);
  }
  return id;
}

async function llamarServidor(ruta, cuerpo) {
  const codigoClase = almacen.leer("codigo-clase", null) || (await pedirCodigoClase());
  if (!codigoClase) throw new Error("Necesitas el código de clase.");
  let respuesta;
  try {
    respuesta = await fetch(`${WORKER_URL}${ruta}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...cuerpo, codigoClase, clienteId: clienteId() }),
    });
  } catch {
    throw new Error("Sin conexión. Revisa tu internet.");
  }
  const datosRespuesta = await respuesta.json().catch(() => ({}));
  if (respuesta.status === 401) {
    almacen.borrar("codigo-clase");
    throw new Error("El código de clase no es correcto. Inténtalo otra vez.");
  }
  if (!respuesta.ok) throw new Error(datosRespuesta.error || "El servidor no respondió. Inténtalo otra vez.");
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
    const escala = Math.min(1, 1600 / Math.max(imagen.naturalWidth, imagen.naturalHeight));
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

// ---------- editor ----------

function crearEditor(valorInicial, alCambiar) {
  const numeros = el("pre", { class: "editor__numeros", "aria-hidden": "true" });
  const area = el("textarea", {
    class: "editor__texto",
    spellcheck: "false",
    autocapitalize: "off",
    autocomplete: "off",
    autocorrect: "off",
    wrap: "off",
    "aria-label": "Tu código",
    placeholder: "Tu código aparecerá aquí",
  });
  area.value = valorInicial;
  let lineaError = null;

  function pintarNumeros() {
    const total = Math.max(1, area.value.split("\n").length);
    numeros.replaceChildren(
      ...Array.from({ length: total }, (_, i) => el("span", { class: i + 1 === lineaError ? "error" : null }, `${i + 1}\n`)),
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

// ---------- errores en español ----------

const ERRORES_SINTAXIS = [
  [/expected ':'/, "falta poner dos puntos ( : ) al final."],
  [/was never closed/, "un paréntesis se abrió y nunca se cerró."],
  [/unterminated string/, "un texto entre comillas no se cerró."],
  [/unmatched/, "sobra un paréntesis de cierre."],
  [/expected an indented block/, "después de los dos puntos, la siguiente línea debe llevar sangría."],
  [/unexpected indent/, "esta línea tiene sangría de más."],
  [/unindent does not match/, "la sangría no coincide con las líneas de arriba."],
  [/cannot assign to|Maybe you meant '=='/, "para comparar se usa == (con = se asigna)."],
  [/invalid syntax/, "Python no entiende esta línea: revisa dos puntos, paréntesis, comillas y = contra ==."],
];

const ERRORES_EJECUCION = {
  NameError: "usas un nombre que Python no conoce: revisa cómo lo escribiste o si falta import math.",
  TypeError: "se mezclaron tipos de datos: ¿convertiste el input() con int() o float()?",
  ValueError: "un dato no se pudo convertir, por ejemplo int() de un número con decimales.",
  ZeroDivisionError: "se dividió entre cero.",
  AttributeError: "esa función no existe en el módulo; revisa el nombre (por ejemplo math.sqrt).",
};

function explicarError(error) {
  const donde = error.linea ? `Línea ${error.linea}: ` : "";
  if (["SyntaxError", "IndentationError", "TabError"].includes(error.tipo)) {
    const regla = ERRORES_SINTAXIS.find(([patron]) => patron.test(error.mensaje));
    return { titulo: "Error de sintaxis", texto: donde + (regla ? regla[1] : "Python no puede leer esta parte.") };
  }
  return { titulo: "El programa se detuvo", texto: donde + (ERRORES_EJECUCION[error.tipo] || `ocurrió ${error.tipo}.`) };
}

// ---------- inicio ----------

function vistaInicio() {
  const filas = [
    {
      ruta: `#/quiz/${Math.max(1, datos.quiz.findIndex((q) => estado.quiz[q.id] === undefined) + 1)}`,
      numero: "?",
      nombre: "Calentamiento",
      detalle: "Opción múltiple · 1 ★ c/u",
      hechos: datos.quiz.filter((q) => estado.quiz[q.id] !== undefined).length,
      total: datos.quiz.length,
    },
    ...datos.niveles.map((nivel, i) => {
      const lista = datos.ejercicios.filter((e) => e.nivel === nivel.id);
      const pendiente = lista.find((e) => estado.ej[e.id] === undefined) || lista[0];
      return {
        ruta: `#/ej/${pendiente.id}`,
        numero: i + 1,
        nombre: nivel.nombre,
        detalle: `${nivel.puntos} ★ por ejercicio`,
        hechos: lista.filter((e) => estado.ej[e.id] !== undefined).length,
        total: lista.length,
      };
    }),
  ];
  const empezado = Object.keys(estado.quiz).length + Object.keys(estado.ej).length > 0;

  return [
    el(
      "div",
      { class: "encabezado" },
      el("h1", {}, "Repaso de Python"),
      el("p", { class: "texto-suave" }, "Resuelve en papel, toma foto y suma puntos."),
    ),
    el(
      "div",
      { class: "marcador" },
      el("div", {}, el("strong", {}, puntosTotales()), el("span", {}, "puntos")),
      el("div", {}, el("strong", {}, ejerciciosResueltos()), el("span", {}, `de ${datos.ejercicios.length} ejercicios`)),
    ),
    el(
      "nav",
      { class: "lista", "aria-label": "Secciones" },
      filas.map((f) =>
        el(
          "a",
          { class: `fila${f.hechos === f.total ? " completa" : ""}`, href: f.ruta },
          el("span", { class: "fila__numero" }, f.hechos === f.total ? "✓" : f.numero),
          el("span", { class: "fila__texto" }, el("strong", {}, f.nombre), el("span", {}, f.detalle)),
          el("span", { class: "fila__avance" }, `${f.hechos}/${f.total}`),
        ),
      ),
    ),
    empezado
      ? el(
          "div",
          { class: "pie-inicio" },
          boton(
            "Reiniciar puntos",
            () => {
              if (!confirm("¿Borrar todos tus puntos y empezar de cero?")) return;
              estado.quiz = {};
              estado.ej = {};
              estado.pistas = {};
              guardarEstado();
              mostrar();
            },
            "boton--enlace",
          ),
        )
      : null,
    barraAcciones(boton(empezado ? "Continuar →" : "Empezar →", () => ir(siguientePendiente()))),
  ];
}

// ---------- calentamiento ----------

function vistaQuiz(numero) {
  const total = datos.quiz.length;
  const pregunta = datos.quiz[numero - 1];
  const opciones = el("div", { class: "opciones", role: "group", "aria-label": "Opciones" });
  const explicacion = el("div", { "aria-live": "polite" });
  const siguiente = boton(numero === total ? "Terminar →" : "Siguiente →", () => ir(numero === total ? "#/quiz/fin" : `#/quiz/${numero + 1}`));

  function pintar() {
    const elegida = estado.quiz[pregunta.id];
    const respondida = elegida !== undefined;
    reemplazar(
      opciones,
      pregunta.opciones.map((texto, i) => {
        let clase = "opcion";
        if (respondida && i === pregunta.correcta) clase += " correcta";
        else if (respondida && i === elegida) clase += " incorrecta";
        else if (respondida) clase += " apagada";
        return el(
          "button",
          { type: "button", class: clase, disabled: respondida, onclick: () => responder(i) },
          el("span", { class: "opcion__letra" }, "ABCD"[i]),
          el("span", {}, texto),
        );
      }),
    );
    if (respondida) {
      const acerto = elegida === pregunta.correcta;
      reemplazar(
        explicacion,
        el("div", { class: `explicacion ${acerto ? "ok" : "mal"}` }, el("strong", {}, acerto ? "¡Correcto! +1 ★" : "No es esa"), pregunta.explicacion),
      );
    }
    siguiente.disabled = !respondida;
  }

  function responder(indice) {
    if (estado.quiz[pregunta.id] !== undefined) return;
    estado.quiz[pregunta.id] = indice;
    guardarEstado();
    if (indice === pregunta.correcta) celebrar(1);
    pintar();
    explicacion.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  pintar();
  return [
    el(
      "div",
      { class: "encabezado" },
      el("div", { class: "encabezado__fila" }, el("span", { class: "etiqueta" }, `Calentamiento · ${numero} de ${total}`), el("span", { class: "chip" }, pregunta.tema)),
      el("div", { class: "progreso" }, el("span", { style: `width:${(numero / total) * 100}%` })),
    ),
    el("h2", {}, pregunta.pregunta),
    pregunta.codigo ? el("pre", { class: "codigo" }, pregunta.codigo) : null,
    opciones,
    explicacion,
    barraAcciones(boton("←", () => ir(numero > 1 ? `#/quiz/${numero - 1}` : "#/"), "boton--claro boton--icono"), siguiente),
  ];
}

function vistaQuizFin() {
  const aciertos = aciertosQuiz();
  const primero = datos.ejercicios.find((e) => estado.ej[e.id] === undefined) || datos.ejercicios[0];
  return [
    el(
      "div",
      { class: "resultado ok" },
      el("div", { class: "resultado__icono" }, "★"),
      el("h1", {}, `${aciertos} de ${datos.quiz.length}`),
      el("p", { class: "texto-suave" }, "Calentamiento terminado. Ahora a programar en papel."),
    ),
    barraAcciones(boton("Ir a los ejercicios →", () => ir(`#/ej/${primero.id}`))),
  ];
}

// ---------- ejercicio ----------

function vistaEjercicio(ejercicio) {
  const paso = pasos[ejercicio.id] || "leer";
  const nivel = nivelDe(ejercicio);
  const delNivel = datos.ejercicios.filter((e) => e.nivel === nivel.id);
  const posicion = delNivel.indexOf(ejercicio) + 1;
  const indice = datos.ejercicios.indexOf(ejercicio);
  const anterior = datos.ejercicios[indice - 1];
  const posterior = datos.ejercicios[indice + 1];
  const resuelto = estado.ej[ejercicio.id] !== undefined;
  preparar().catch(() => {});

  const chipValor = resuelto
    ? el("span", { class: "chip chip--ok" }, `✓ +${estado.ej[ejercicio.id]} ★`)
    : el("span", { class: "chip" }, `${valorActual(ejercicio)} ★`);
  const encabezado = el(
    "div",
    { class: "encabezado" },
    el("div", { class: "encabezado__fila" }, el("span", { class: "etiqueta" }, `${nivel.nombre} · ${posicion} de ${delNivel.length}`), chipValor),
    el("div", { class: "progreso" }, el("span", { style: `width:${(posicion / delNivel.length) * 100}%` })),
  );

  function cambiarPaso(nuevo) {
    pasos[ejercicio.id] = nuevo;
    mostrar();
  }

  if (paso === "codigo") return [encabezado, ...pasoCodigo(ejercicio, cambiarPaso)];
  if (paso === "resultado" && resultados[ejercicio.id]) return [encabezado, ...pasoResultado(ejercicio, cambiarPaso, posterior)];

  // --- paso 1: leer el problema ---
  const listaPistas = el("div", { class: "pistas" });
  function pintarPistas() {
    const vistas = estado.pistas[ejercicio.id] || 0;
    const quedan = ejercicio.pistas.length - vistas;
    const cuesta = !resuelto && valorActual(ejercicio) > 1;
    reemplazar(
      listaPistas,
      ejercicio.pistas.slice(0, vistas).map((texto) => el("div", { class: "pista" }, texto)),
      quedan > 0
        ? boton(
            `💡 ${vistas ? "Otra pista" : "Pista"}${cuesta ? " (−1 ★)" : ""}`,
            () => {
              estado.pistas[ejercicio.id] = (estado.pistas[ejercicio.id] || 0) + 1;
              guardarEstado();
              if (!resuelto) chipValor.textContent = `${valorActual(ejercicio)} ★`;
              pintarPistas();
            },
            "boton--enlace",
          )
        : null,
    );
  }
  pintarPistas();

  return [
    encabezado,
    el("h1", {}, ejercicio.titulo),
    el("p", {}, ejercicio.descripcion),
    el(
      "div",
      { class: "datos" },
      el("div", { class: "dato" }, el("span", {}, "Entrada"), el("span", {}, ejercicio.entrada)),
      el(
        "div",
        { class: "dato" },
        el("span", {}, "Salida"),
        Array.isArray(ejercicio.salida)
          ? el("ul", { class: "lista-salida" }, ejercicio.salida.map((linea) => el("li", {}, linea)))
          : el("span", {}, ejercicio.salida),
      ),
      ejercicio.usa ? el("div", { class: "dato usa" }, el("span", {}, "Usa"), el("span", {}, el("code", {}, ejercicio.usa))) : null,
      el("div", { class: "dato" }, el("span", {}, "Ejemplo"), consolaEjemplo(ejercicio.ejemplo)),
    ),
    listaPistas,
    barraAcciones(
      boton("←", () => ir(anterior ? `#/ej/${anterior.id}` : "#/"), "boton--claro boton--icono"),
      boton("Ya lo resolví en papel", () => cambiarPaso("codigo")),
      boton("→", () => ir(posterior ? `#/ej/${posterior.id}` : "#/"), "boton--claro boton--icono"),
    ),
  ];
}

function pasoCodigo(ejercicio, cambiarPaso) {
  const claveCodigo = `codigo:${ejercicio.id}`;
  const editor = crearEditor(almacen.leer(claveCodigo, ""), (texto) => almacen.guardar(claveCodigo, texto));
  const contenedorEditor = el("div", { hidden: !editor.valor.trim() }, editor.nodo);
  const estadoFoto = el("p", { class: "estado", "aria-live": "polite" });
  const avisoLectura = el("div", { class: "aviso-lectura", hidden: true });
  const funciones = [...new Set(ejercicio.pruebas.filter((p) => p.tipo === "funcion").map((p) => p.funcion))];
  const revisar = boton("Revisar", () => revisarCodigo());
  const escribir = boton(
    "o escríbela aquí",
    () => {
      contenedorEditor.hidden = false;
      escribir.remove();
      contenedorEditor.querySelector("textarea").focus();
    },
    "boton--enlace",
  );

  const entradaFoto = el("input", { type: "file", accept: "image/*", class: "oculto", id: `foto-${ejercicio.id}` });
  const vistaPrevia = el("img", { alt: "Tu foto", hidden: true });
  const tarjetaFoto = el(
    "label",
    { class: "foto", for: entradaFoto.id },
    el("span", { class: "foto__icono", "aria-hidden": "true" }, "📷"),
    el("strong", {}, "Tomar foto de tu hoja"),
    el("span", { class: "texto-suave" }, "De frente, con buena luz"),
    vistaPrevia,
  );

  entradaFoto.addEventListener("change", async () => {
    const archivo = entradaFoto.files[0];
    entradaFoto.value = "";
    if (!archivo) return;
    revisar.disabled = true;
    estadoFoto.textContent = "Leyendo tu letra…";
    try {
      const imagen = await prepararImagen(archivo);
      vistaPrevia.src = imagen;
      vistaPrevia.hidden = false;
      const lectura = await llamarServidor("/transcribir", { imagen, funciones });
      editor.valor = lectura.codigo || "";
      contenedorEditor.hidden = false;
      escribir.remove();
      const textos = {
        buena: "Revisa que diga lo mismo que tu hoja. Corrige solo lo que se leyó mal.",
        regular: "Algunas partes costó leerlas. Compara con tu hoja y corrige solo lo que se leyó mal.",
        mala: "Fue difícil leer la foto. Si hay muchos errores, toma otra con mejor luz.",
      };
      avisoLectura.className = `aviso-lectura ${lectura.legibilidad || "buena"}`;
      avisoLectura.textContent = textos[lectura.legibilidad] || textos.buena;
      avisoLectura.hidden = false;
      estadoFoto.textContent = "";
    } catch (error) {
      estadoFoto.textContent = error.message;
    } finally {
      revisar.disabled = false;
    }
  });

  async function revisarCodigo() {
    const codigo = editor.valor;
    if (!codigo.trim()) {
      estadoFoto.textContent = CON_IA ? "Primero toma la foto de tu hoja." : "Primero escribe tu código.";
      return;
    }
    revisar.disabled = true;
    revisar.textContent = "Revisando…";
    try {
      const reporte = await evaluar(codigo, ejercicio);
      const pasa = !reporte.error && reporte.pruebas.length > 0 && reporte.pruebas.every((p) => p.ok) && reporte.avisos.length === 0;
      let ganados = 0;
      if (pasa && estado.ej[ejercicio.id] === undefined) {
        ganados = valorActual(ejercicio);
        estado.ej[ejercicio.id] = ganados;
        guardarEstado();
        celebrar(ganados);
      }
      if (reporte.error?.linea) editor.marcarLinea(reporte.error.linea);
      resultados[ejercicio.id] = { reporte, codigo, pasa, ganados };
      cambiarPaso("resultado");
    } catch (error) {
      estadoFoto.textContent =
        error.message === "TIEMPO" ? "Tu programa tardó demasiado y se detuvo." : "No se pudo cargar Python. Revisa tu internet y recarga.";
      revisar.disabled = false;
      revisar.textContent = "Revisar";
    }
  }

  return [
    el("h2", {}, CON_IA ? "Sube tu solución" : "Escribe tu solución"),
    CON_IA ? [tarjetaFoto, entradaFoto] : null,
    estadoFoto,
    avisoLectura,
    contenedorEditor,
    CON_IA && contenedorEditor.hidden ? escribir : null,
    barraAcciones(boton("←", () => cambiarPaso("leer"), "boton--claro boton--icono"), revisar),
  ].flat();
}

function pasoResultado(ejercicio, cambiarPaso, posterior) {
  const { reporte, codigo, pasa, ganados } = resultados[ejercicio.id];
  const siguiente = () => ir(posterior ? `#/ej/${posterior.id}` : "#/");
  const cajaIA = el("section", { class: "ia", hidden: true, "aria-live": "polite" });

  async function pedirRetro() {
    cajaIA.hidden = false;
    reemplazar(cajaIA, el("p", { class: "texto-suave" }, "La IA está revisando tu código…"));
    try {
      const retro = await llamarServidor("/retro", {
        problema: { titulo: ejercicio.titulo, descripcion: ejercicio.descripcion, requisitos: [ejercicio.entrada, [ejercicio.salida].flat().join("; "), ejercicio.usa].filter(Boolean) },
        codigo,
        resultados: {
          error: reporte.error,
          avisos: reporte.avisos,
          pruebas: reporte.pruebas.map(({ descripcion, ok, detalle }) => ({ descripcion, ok, detalle })),
        },
      });
      reemplazar(
        cajaIA,
        el("strong", {}, "Comentarios"),
        retro.resumen ? el("p", {}, retro.resumen) : null,
        retro.observaciones?.length ? el("ul", {}, retro.observaciones.map((o) => el("li", {}, o))) : null,
        retro.pregunta_guia ? el("p", { class: "pregunta-guia" }, `🤔 ${retro.pregunta_guia}`) : null,
      );
    } catch (error) {
      reemplazar(cajaIA, el("p", { class: "texto-suave" }, error.message), boton("Reintentar", pedirRetro, "boton--enlace"));
    }
  }

  if (pasa) {
    const yaTenia = !ganados;
    return [
      el(
        "div",
        { class: "resultado ok" },
        el("div", { class: "resultado__icono" }, "✓"),
        el("h1", {}, "¡Correcto!"),
        el("p", { class: "resultado__puntos" }, yaTenia ? "Ya lo tenías resuelto" : `+${ganados} ★`),
      ),
      cajaIA,
      CON_IA ? boton("Ver comentarios de la IA", (evento) => { evento.currentTarget.remove(); pedirRetro(); }, "boton--enlace") : null,
      barraAcciones(boton(posterior ? "Siguiente ejercicio →" : "Volver al inicio", siguiente)),
    ].flat();
  }

  const fallidas = reporte.pruebas.filter((p) => !p.ok);
  let titulo = "Casi";
  let subtitulo = `Pasaste ${reporte.pruebas.length - fallidas.length} de ${reporte.pruebas.length} casos.`;
  if (reporte.error && !reporte.pruebas.length) {
    const info = explicarError(reporte.error);
    titulo = info.titulo;
    subtitulo = info.texto;
  } else if (!fallidas.length && reporte.avisos.length) {
    subtitulo = "Funciona, pero no cumple una regla del ejercicio.";
  }
  if (CON_IA) pedirRetro();

  return [
    el(
      "div",
      { class: "resultado mal" },
      el("div", { class: "resultado__icono" }, "✗"),
      el("h1", {}, titulo),
      el("p", { class: "texto-suave" }, subtitulo),
    ),
    reporte.avisos.map((a) => el("p", { class: "pista" }, a)),
    fallidas.length
      ? el(
          "ul",
          { class: "casos" },
          fallidas.slice(0, 3).map((p) => el("li", { class: "mal" }, el("strong", {}, p.descripcion), el("span", {}, p.detalle))),
        )
      : null,
    cajaIA,
    reporte.consola
      ? el("details", { class: "consola" }, el("summary", {}, "Ver lo que imprimió tu programa"), el("pre", { class: "codigo" }, reporte.consola))
      : null,
    barraAcciones(boton("Saltar", siguiente, "boton--claro"), boton("Corregir", () => cambiarPaso("codigo"))),
  ].flat();
}

// ---------- navegación ----------

function mostrar() {
  if (!datos) return;
  const ruta = location.hash.replace(/^#\/?/, "");
  let contenido = null;
  let titulo = "Repaso TC1037";
  if (ruta === "quiz/fin") {
    contenido = vistaQuizFin();
  } else if (ruta.startsWith("quiz/")) {
    const numero = Number(ruta.slice(5));
    if (numero >= 1 && numero <= datos.quiz.length) {
      contenido = vistaQuiz(numero);
      titulo = `Calentamiento ${numero} · Repaso TC1037`;
    }
  } else if (ruta.startsWith("ej/")) {
    const ejercicio = datos.ejercicios.find((e) => e.id === ruta.slice(3));
    if (ejercicio) {
      contenido = vistaEjercicio(ejercicio);
      titulo = `${ejercicio.titulo} · Repaso TC1037`;
    }
  }
  if (!contenido) contenido = vistaInicio();
  document.title = titulo;
  reemplazar(vista, contenido);
  window.scrollTo(0, 0);
  vista.focus({ preventScroll: true });
}

async function iniciar() {
  try {
    const respuesta = await fetch("data/problemas.json", { cache: "no-cache" });
    datos = await respuesta.json();
  } catch {
    reemplazar(vista, el("p", {}, "No se pudieron cargar los ejercicios. Recarga la página."));
    return;
  }
  pintarPuntos();
  window.addEventListener("hashchange", mostrar);
  mostrar();
}

iniciar();
