"""Evaluador del repaso TC1037.

Corre dentro de Pyodide (en el navegador del alumno). Ejecuta el codigo
transcrito contra las pruebas de un problema y regresa un JSON con los
resultados. No depende de nada fuera de la biblioteca estandar.
"""

import json
import re
import sys
import unicodedata

ARCHIVO = "tu_codigo.py"
MAX_SALIDA = 4000


class _SinMasEntradas(Exception):
    pass


class _Salida:
    """Captura lo que imprime el programa.

    impreso: solo lo que sale de print().
    consola: lo que veria el alumno en pantalla (incluye mensajes de input).
    """

    def __init__(self):
        self.impreso = []
        self.consola = []

    def write(self, texto):
        self.impreso.append(texto)
        self.consola.append(texto)
        return len(texto)

    def flush(self):
        pass

    def texto_impreso(self):
        return "".join(self.impreso)

    def texto_consola(self):
        texto = "".join(self.consola)
        if len(texto) > MAX_SALIDA:
            texto = texto[:MAX_SALIDA] + "\n..."
        return texto


def normaliza(texto):
    texto = unicodedata.normalize("NFD", str(texto))
    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
    return " ".join(texto.lower().split())


def _numeros(texto):
    texto = re.sub(r"(?<=\d),(?=\d{3})", "", texto)
    return [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", texto)]


def _formato(valor):
    if isinstance(valor, str):
        return f'"{valor}"'
    if isinstance(valor, float):
        return f"{valor:.4f}".rstrip("0").rstrip(".") if abs(valor) < 1e9 else str(valor)
    return repr(valor)


def _linea_del_error(error):
    if isinstance(error, SyntaxError) and error.filename == ARCHIVO:
        return error.lineno
    linea = None
    rastro = error.__traceback__
    while rastro is not None:
        if rastro.tb_frame.f_code.co_filename == ARCHIVO:
            linea = rastro.tb_lineno
        rastro = rastro.tb_next
    return linea


def _describe_error(error):
    return {
        "tipo": type(error).__name__,
        "mensaje": str(error.msg) if isinstance(error, SyntaxError) else str(error),
        "linea": _linea_del_error(error),
    }


def _ejecutar(codigo, entradas):
    """Ejecuta el programa completo. entradas=None hace que input() detenga el programa."""
    salida = _Salida()
    pendientes = None if entradas is None else [str(e) for e in entradas]

    def input_simulado(mensaje=""):
        if pendientes is None:
            raise _SinMasEntradas()
        salida.consola.append(str(mensaje))
        if not pendientes:
            raise _SinMasEntradas()
        valor = pendientes.pop(0)
        salida.consola.append(valor + "\n")
        return valor

    espacio = {"__name__": "__main__", "input": input_simulado}
    error = None
    sin_entradas = False
    original = sys.stdout
    sys.stdout = salida
    try:
        exec(compile(codigo, ARCHIVO, "exec"), espacio)
    except _SinMasEntradas:
        sin_entradas = True
    except SyntaxError as e:
        error = _describe_error(e)
    except Exception as e:
        error = _describe_error(e)
    finally:
        sys.stdout = original
    return espacio, salida, error, sin_entradas


def _compara(esperado, obtenido, tol):
    """Regresa (ok, detalle) comparando el valor de retorno con el esperado."""
    if obtenido is None:
        return False, "tu función regresó None: ¿le falta el return o usa print() en lugar de return?"
    if isinstance(esperado, bool):
        if isinstance(obtenido, bool):
            ok = obtenido == esperado
            return ok, "" if ok else f"se esperaba {esperado} y tu función regresó {obtenido}"
        if isinstance(obtenido, str):
            return False, f"regresó el texto {_formato(obtenido)}; se esperaba el valor booleano {esperado} (sin comillas)"
        return False, f"se esperaba el booleano {esperado} y tu función regresó {_formato(obtenido)}"
    if isinstance(esperado, (int, float)):
        if isinstance(obtenido, bool) or not isinstance(obtenido, (int, float)):
            return False, f"se esperaba un número ({_formato(esperado)}) y tu función regresó {_formato(obtenido)} ({type(obtenido).__name__})"
        ok = abs(obtenido - esperado) <= tol
        return ok, "" if ok else f"se esperaba {_formato(esperado)} y tu función regresó {_formato(obtenido)}"
    if isinstance(esperado, str):
        if not isinstance(obtenido, str):
            return False, f"se esperaba el texto {_formato(esperado)} y tu función regresó {_formato(obtenido)}"
        ok = normaliza(obtenido) == normaliza(esperado)
        return ok, "" if ok else f"se esperaba {_formato(esperado)} y tu función regresó {_formato(obtenido)}"
    ok = obtenido == esperado
    return ok, "" if ok else f"se esperaba {_formato(esperado)} y se obtuvo {_formato(obtenido)}"


def _prueba_funcion(espacio, prueba):
    nombre = prueba["funcion"]
    args = prueba.get("args", [])
    llamada = f"{nombre}({', '.join(_formato(a) for a in args)})"
    resultado = {"descripcion": prueba.get("descripcion") or llamada, "ok": False, "detalle": ""}
    funcion = espacio.get(nombre)
    if not callable(funcion):
        resultado["detalle"] = f"no encontré la función {nombre}(). Revisa que el nombre esté escrito exactamente así y que esté declarada con def."
        return resultado
    salida = _Salida()
    original = sys.stdout
    sys.stdout = salida
    try:
        obtenido = funcion(*args)
    except _SinMasEntradas:
        resultado["detalle"] = "la función pidió datos con input(); los datos deben llegar como parámetros."
        return resultado
    except Exception as e:
        info = _describe_error(e)
        donde = f" (línea {info['linea']})" if info["linea"] else ""
        resultado["detalle"] = f"al llamarla ocurrió {info['tipo']}{donde}: {info['mensaje']}"
        return resultado
    finally:
        sys.stdout = original
    ok, detalle = _compara(prueba["esperado"], obtenido, prueba.get("tol", 0.01))
    if not ok and obtenido is None and salida.texto_impreso().strip():
        detalle = "tu función imprime el resultado pero no lo regresa: usa return para entregarlo."
    resultado["ok"] = ok
    resultado["detalle"] = detalle
    return resultado


def _texto_comparable(texto):
    texto = re.sub(r"[^\w\s.\-]", " ", normaliza(texto))
    return " ".join(texto.split())


def _lineas_iguales(obtenida, esperada, tol):
    try:
        return abs(float(obtenida.strip()) - float(esperada)) <= tol
    except ValueError:
        return _texto_comparable(obtenida) == _texto_comparable(esperada)


def _prueba_programa(codigo, prueba):
    entradas = [str(e) for e in prueba.get("entradas", [])]
    descripcion = prueba.get("descripcion") or "Entradas: " + ", ".join(entradas)
    _, salida, error, sin_entradas = _ejecutar(codigo, entradas)
    impreso = salida.texto_impreso()
    tol = prueba.get("tol", 0.01)
    detalle = ""
    if "salida" in prueba:
        esperadas = [str(linea) for linea in prueba["salida"]]
        obtenidas = [linea for linea in impreso.splitlines() if linea.strip()]
        iguales = len(obtenidas) == len(esperadas) and all(
            _lineas_iguales(o, e, tol) for o, e in zip(obtenidas, esperadas)
        )
        if not iguales:
            impresas = " / ".join(linea.strip() for linea in obtenidas[:6]) or "nada"
            detalle = f"se esperaba {' / '.join(esperadas)} y tu programa imprimió {impresas}."
    else:
        texto_normal = normaliza(impreso)
        numeros = _numeros(impreso)
        faltan = []
        for buscado in prueba.get("contiene", []):
            if isinstance(buscado, (int, float)) and not isinstance(buscado, bool):
                if not any(abs(n - buscado) <= tol for n in numeros):
                    faltan.append(_formato(buscado))
            elif normaliza(buscado) not in texto_normal:
                faltan.append(f'"{buscado}"')
        if faltan:
            detalle = "en lo que imprimió tu programa no aparece " + " ni ".join(faltan) + "."
    resultado = {"descripcion": descripcion, "ok": not detalle and error is None, "detalle": detalle}
    if error is not None:
        donde = f" en la línea {error['linea']}" if error["linea"] else ""
        resultado["detalle"] = f"el programa se detuvo con {error['tipo']}{donde}."
    elif detalle:
        if sin_entradas:
            resultado["detalle"] += " Además, pidió más datos de los que se dieron."
        elif not impreso.strip():
            resultado["detalle"] += " ¿Te faltó el print() o llamar a main()?"
    resultado["consola"] = salida.texto_consola()
    return resultado


def _revisa_prohibidos(codigo, problema):
    avisos = []
    sin_comentarios = "\n".join(linea.split("#")[0] for linea in codigo.splitlines())
    for regla in problema.get("prohibido", []):
        if regla["texto"] in sin_comentarios:
            avisos.append(regla["mensaje"])
    return avisos


def evaluar(codigo, problema):
    """Evalua el codigo del alumno contra las pruebas del problema."""
    codigo = codigo.replace("\t", "    ")
    espacio, salida, error, _ = _ejecutar(codigo, None)
    reporte = {"error": error, "pruebas": [], "avisos": _revisa_prohibidos(codigo, problema), "consola": ""}
    if error is not None and error["tipo"] in ("SyntaxError", "IndentationError", "TabError"):
        return reporte
    for prueba in problema.get("pruebas", []):
        if prueba["tipo"] == "funcion":
            reporte["pruebas"].append(_prueba_funcion(espacio, prueba))
        else:
            reporte["pruebas"].append(_prueba_programa(codigo, prueba))
    ejemplo = problema.get("ejemplo", {}).get("entradas")
    if ejemplo is not None:
        _, salida_ejemplo, error_ejemplo, sin_entradas = _ejecutar(codigo, ejemplo)
        consola = salida_ejemplo.texto_consola()
        if error_ejemplo is not None:
            donde = f" (línea {error_ejemplo['linea']})" if error_ejemplo["linea"] else ""
            consola = consola.rstrip("\n") + f"\n[{error_ejemplo['tipo']}{donde}: {error_ejemplo['mensaje']}]"
        elif sin_entradas:
            consola = consola.rstrip("\n") + "\n[el programa pidió más datos de los del ejemplo]"
        reporte["consola"] = consola
        reporte["impreso"] = salida_ejemplo.texto_impreso()
    return reporte


def evaluar_json(texto):
    datos = json.loads(texto)
    return json.dumps(evaluar(datos["codigo"], datos["problema"]), ensure_ascii=False)
