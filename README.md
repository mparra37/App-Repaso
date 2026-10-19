# Repaso TC1037: funciones, math y condicionales

App web para practicar el examen escrito. Tiene dos partes:

- **Calentamiento** (18 preguntas): opción múltiple y «¿qué imprime?», como las secciones I y II del examen. Se califica al instante, da una pista cuando la respuesta es incorrecta y, después de 3 intentos, permite ver la explicación.
- **Problemas** (12, en tres niveles: básicos, intermedios y tipo examen). El alumno resuelve en papel, toma una foto, la IA transcribe el código, el alumno corrige solo los errores de lectura y la app:
  1. ejecuta el código **en el navegador** (Python con Pyodide) contra pruebas automáticas;
  2. pide a la IA una retroalimentación que **no da la respuesta**, basada en los resultados de esas pruebas.

  Cada problema tiene 3 pistas escalonadas, escritas a mano, que no gastan API.

Quien decide si el programa es correcto son las pruebas, no la IA. La IA solo lee la foto y redacta la retroalimentación.

## Estructura

```
app-repaso/
├── docs/                     ← el sitio que publica GitHub Pages
│   ├── index.html
│   ├── css/estilos.css
│   ├── js/config.js          ← aquí va la URL del Worker
│   ├── js/app.js             ← interfaz
│   ├── js/ejecutor.js        ← corre Python en un Web Worker (con límite de tiempo)
│   ├── js/pyworker.js        ← carga Pyodide
│   ├── py/evaluador.py       ← ejecuta las pruebas del alumno
│   └── data/problemas.json   ← preguntas, problemas, pruebas y pistas
├── worker/                   ← Cloudflare Worker: guarda la API key de Claude
│   ├── worker.js
│   ├── wrangler.toml         ← modelo, origen permitido y límite por alumno
│   └── package.json
└── soluciones_profesor/      ← soluciones de referencia y verificador (NO se sube: está en .gitignore)
```

## 1. Probar en tu computadora

```bash
python -m http.server 8037 --directory docs
```

Abre <http://localhost:8037>. Sin Worker configurado, la app funciona en «modo sin IA»: el alumno escribe su código en el editor, y las pruebas y las pistas siguen funcionando. Ese mismo modo te sirve de plan B en clase si falla el internet o la API.

> Tiene que abrirse con un servidor (`http://`). Si abres `index.html` con doble clic (`file://`), no carga.

## 2. Crear la API key de Claude

La API se paga aparte de una suscripción de Claude (Pro o Max): esa suscripción no incluye crédito para la API.

1. Entra a <https://console.anthropic.com> (puede llevarte a `platform.claude.com`; es la misma consola) y crea tu cuenta. Puedes usar tu Gmail.
2. **Crédito:** en *Settings → Billing* compra crédito prepagado (con 5–10 USD sobra para el repaso). Deja **apagada la recarga automática**: así nunca se cobra más de lo que cargaste.
3. **Workspace con límite:** en *Settings → Workspaces* crea uno llamado `Repaso TC1037` y ponle un **límite de gasto** (por ejemplo, 10 USD al mes).
4. **Key:** en *Settings → API Keys → Create Key*, elige el workspace `Repaso TC1037` y ponle un nombre como `worker-repaso`. La key empieza con `sk-ant-` y **solo se muestra una vez**: cópiala y no la cierres hasta guardarla en el Worker (paso 3). Si la pierdes, bórrala y crea otra.

No pegues la key en el código, en `config.js`, en Drive ni en un chat: solo va como secreto del Worker.

### Modelo

El modelo se configura en `worker/wrangler.toml` con `MODELO`:

| Modelo | Valor de `MODELO` | Costo aproximado por intento (foto + retroalimentación) |
|---|---|---|
| Claude Haiku 5.5 (por defecto) | `claude-haiku-5-5` | ~0.1–0.2 centavos de dólar |
| Claude Opus 5.5 | `claude-opus-5-5` | ~4–8 centavos de dólar |

Empieza con Haiku. Si al probar con hojas reales lee mal la letra (confunde caracteres, pierde la sangría o «corrige» el código del alumno), cambia `MODELO` a `claude-opus-5-5` y vuelve a ejecutar `npx wrangler deploy`; no hay que tocar nada más. Los costos son estimaciones: después de tu prueba, revisa *Usage* en la consola para ver el gasto real.

## 3. Publicar el Worker (Cloudflare, plan gratuito)

GitHub Pages solo sirve archivos estáticos: si la API key estuviera en el JavaScript, cualquiera podría copiarla con F12. El Worker es un programa pequeño que corre en un servidor de Cloudflare, guarda la key como secreto y solo atiende solicitudes que traen el **código de clase**. El alumno nunca recibe la key, solo la respuesta.

Necesitas Node.js (ya lo tienes instalado). Abre una terminal en la carpeta `app-repaso/worker` y sigue estos pasos.

1. **Instala las dependencias** (el SDK de Claude y wrangler, la herramienta de Cloudflare):

   ```bash
   npm install
   ```

2. **Entra a Cloudflare.** Si no tienes cuenta, el navegador te deja crear una gratis:

   ```bash
   npx wrangler login
   ```

3. **Indica desde dónde se puede usar.** Abre `wrangler.toml` y cambia `ORIGENES_PERMITIDOS` por la dirección de tu GitHub Pages, por ejemplo `https://tu-usuario.github.io` (sin el nombre del repositorio y sin diagonal final). Las pruebas desde `localhost` siempre están permitidas.

4. **Guarda la key de Claude.** Te la pide en la terminal; pégala y presiona Enter (no se ve mientras la pegas):

   ```bash
   npx wrangler secret put ANTHROPIC_API_KEY
   ```

   La primera vez puede preguntarte si quieres crear el Worker `repaso-tc1037`: contesta que sí.

5. **Guarda el código de clase.** Es la palabra que les dirás a los alumnos el día del repaso, por ejemplo `tc1037-funciones`:

   ```bash
   npx wrangler secret put CODIGO_CLASE
   ```

6. **Publica el Worker:**

   ```bash
   npx wrangler deploy
   ```

   Al terminar muestra una URL como `https://repaso-tc1037.tu-cuenta.workers.dev`. Cópiala para el paso 4.

Para cambiar el modelo, el origen o el límite después, edita `wrangler.toml` y repite `npx wrangler deploy`. Para cambiar la key o el código de clase, repite el `secret put` correspondiente; se aplica sin volver a publicar.

Para ver errores en vivo mientras pruebas (por ejemplo, una key mal pegada):

```bash
npx wrangler tail
```

## 4. Conectar el sitio con el Worker

En `docs/js/config.js`:

```js
window.REPASO_CONFIG = {
  workerUrl: "https://repaso-tc1037.tu-cuenta.workers.dev",
};
```

## 5. Publicar en GitHub Pages

1. Crea un repositorio en GitHub, por ejemplo `repaso-tc1037`. Puede ser público: la key no está en el código y las soluciones de referencia quedan fuera por el `.gitignore`.
2. Sube la carpeta:

```bash
git init
```

```bash
git add .
```

```bash
git commit -m "Repaso TC1037"
```

```bash
git branch -M main
```

```bash
git remote add origin https://github.com/TU-USUARIO/repaso-tc1037.git
```

```bash
git push -u origin main
```

3. En GitHub: *Settings → Pages → Build and deployment → Deploy from a branch*, rama `main`, carpeta **`/docs`**.
4. En uno o dos minutos queda en `https://tu-usuario.github.io/repaso-tc1037/`.

## 6. Prueba antes de la clase

1. Abre el sitio publicado desde tu celular.
2. Entra a un problema, escribe en papel una solución con un error a propósito (por ejemplo `=` en lugar de `==`), tómale foto y pulsa «Leer mi código». La primera vez te pedirá el código de clase.
3. Pulsa «Revisar mi solución»: deben aparecer el error, las pruebas y la retroalimentación.

Si algo falla, ejecuta `npx wrangler tail` en la carpeta `worker` mientras repites la prueba: ahí aparece el error que devolvió Claude (por ejemplo, una key inválida o sin crédito).

## Cómo usarlo en la sesión (sugerencia)

1. **10 min, calentamiento** individual desde el celular.
2. **30–40 min, problemas básicos e intermedios** en papel, en parejas o solos. Pide que tomen la foto **sin nombre ni matrícula** en la hoja: la imagen se envía a la API de Claude.
3. **15–20 min, un problema tipo examen** con tiempo y sin pistas.
4. Cierre: comenta los errores que más viste (`print` en lugar de `return`, `floor` en lugar de `ceil`, olvidar `main()`, `=` en lugar de `==`).

Cosas que conviene decirles:

- En el paso «Revisa la lectura» solo se corrige lo que la IA leyó mal. Si corrigen su lógica ahí, se pierde el ensayo del examen.
- Las líneas que la IA no pudo leer bien terminan en `# (?)`.
- Letra clara, una instrucción por renglón y la sangría bien marcada mejoran mucho la lectura.

## Agregar o cambiar problemas

Todo está en `docs/data/problemas.json`. Cada problema tiene:

- `descripcion`, `requisitos`, `entrada`, `salida` y `ejemplo` (`entradas` que se capturan y `texto` que se muestra);
- `pruebas`:
  - `{"tipo": "funcion", "funcion": "multa", "args": [75, 60], "esperado": 500}` llama a la función y compara lo que regresa (números con tolerancia `tol`, 0.01 por defecto; textos sin importar mayúsculas ni acentos; booleanos exactos);
  - `{"tipo": "programa", "entradas": ["0"], "contiene": ["Error"]}` corre el programa completo con esas entradas y busca números o textos en lo que imprime;
- `pistas`: tres, de menos a más ayuda;
- `prohibido` (opcional): texto que no debe aparecer en el código, como `max(`.

Después de editar, agrega la solución en `soluciones_profesor/soluciones.py` y verifica que las pruebas y el ejemplo coincidan:

```bash
python -X utf8 soluciones_profesor/verificar.py
```

## Límites conocidos

- Con letra muy difícil, la transcripción falla. El paso de revisión lo compensa, pero depende de la honestidad del alumno.
- Las pruebas detectan si el programa funciona, no si está bien escrito. Para eso está la retroalimentación de la IA, que también señala detalles de sintaxis que cuentan en el examen.
- Las respuestas esperadas de las pruebas están en `problemas.json` y un alumno curioso podría leerlas. Para una herramienta de práctica no importa.
- El límite por alumno del Worker cuenta por navegador, no por IP: todo el salón sale a internet con la misma IP del campus.
