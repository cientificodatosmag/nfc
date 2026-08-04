# NFC Tag Master — rotulado de módulos de riego

App Android para **rotular masivamente etiquetas NTAG21x** de los módulos de
riego de Ingenio Magdalena: graba el código del módulo en cada etiqueta y la
protege con contraseña, en ráfaga y sin tocar la pantalla entre una y otra.

No es una PWA con Web NFC. Es un **APK con plugin nativo**, y esa distinción es
todo el proyecto: Web NFC solo escribe NDEF y no puede fijar la contraseña de la
etiqueta. Escribir en los registros CFG0/CFG1 de una NTAG exige comandos crudos
sobre `NfcA`, que solo existen en Android nativo.

## Qué hace

| Pestaña | Para qué |
|---|---|
| Modo ráfaga | Borra etiquetas una tras otra, sin pulsar nada entre ellas |
| Protección | Pone contraseña (PWD/PACK) y protege desde AUTH0 |
| Inspección | Lee tipo, UID, memoria y estado de protección |
| **Rotulado por módulo** | El trabajo real: graba `CODIGO-001`…`CODIGO-NNN` en orden |
| Historial | Registro local de todo lo hecho |

### Rotulado

Cada módulo lleva **ramales + 4** etiquetas, y el juego completo se graba **dos
veces sobre dos juegos de etiquetas distintos**. Un módulo solo cuenta como
cumplido cuando las dos pasadas terminaron.

Al acabar la pasada 1 la app **se detiene y no continúa sola**. El operador
tiene en la mano la etiqueta recién grabada, todavía pegada al teléfono, y la
pasada 2 empieza por el 001: seguir de largo la regrabaría.

El avance se comparte entre teléfonos (ver abajo) y se puede exportar a CSV.

## Cómo está armado

```
index.html app.js styles.css   la app
nfc-bridge.js                  puente al plugin nativo
config.js sync.js              configuración y sincronización
sw.js                          service worker (solo en la versión navegador)
modulos.json                   maestro de módulos que viaja en el APK
plugin-nfc/                    plugin Capacitor con el código Java del NFC
api/                           backend en Vercel (registro compartido)
tools/                         Oracle -> modulos.json, y reportes
tests/                         pruebas que corren en la CI
```

El APK lo compila **GitHub Actions** en cada push: descárgalo del artefacto
`NFC-Tag-Master-Release.apk` de la última ejecución.

### Registro compartido

Varios teléfonos rotulan a la vez, así que el avance vive en un **log
append-only** en Postgres (Neon) detrás de funciones en Vercel. Nunca se
actualiza ni se borra una fila: lo que ve la app es una *proyección* del log.

Esa decisión es la que hace que dos teléfonos que trabajaron sin señal converjan
al mismo resultado sin importar en qué orden sincronicen, y que cualquier
destrozo sea reversible mirando `recibido_en`.

Sin señal la app funciona igual y encola lo grabado. Ver
[api/README.md](api/README.md) y [sync.js](sync.js).

### El maestro de módulos

`cargarModulos()` intenta tres fuentes en orden: **servidor**, **copia
guardada**, **copia dentro del APK**. Por eso se puede corregir el número de
ramales de un módulo sin reinstalar la app en cada teléfono, y aun así se puede
rotular sin señal. La pantalla dice siempre de cuál de las tres salió.

El maestro se regenera desde Oracle:

```bash
python tools/actualizar-maestro.py --solo-ver   # enseña el diff y no toca nada
python tools/actualizar-maestro.py              # enseña el diff y pregunta
```

Nunca escribe sin mostrar antes qué entra, qué sale y qué cambia, y avisa en
rojo si a un módulo **ya rotulado** le cambia el número de ramales: eso deja
etiquetas físicas que dicen 001..N frente a un maestro que espera otra cantidad,
y no se arregla con un `git revert`.

No hay tarea programada porque GitHub Actions no alcanza la IP interna de
Oracle: esto se corre desde dentro de la red. El `git push` sí dispara Vercel y
la recompilación del APK, que es lo único que necesita estar en la nube.

## Seguridad de las etiquetas

- Contraseñas de exactamente 4 caracteres se escriben tal cual. Cualquier otra
  longitud usa los primeros 4 bytes de `SHA-256("NFC_SALT_2026::" + clave)`.
- **`CFGLCK` y `AUTHLIM` se dejan siempre en 0.** Son irreversibles: `CFGLCK`
  congela la configuración para siempre y `AUTHLIM` puede dejar la etiqueta
  inservible tras unos intentos fallidos.

## Pruebas

```bash
npm test                          # las tres suites de JS, como en la CI
python tools/prueba_normalizar.py # unificación de nombres (no corre en la CI)
```

- `tests/rotulado.test.mjs` — doble pasada, migración del avance, identificadores
- `tests/backend.test.mjs` — validación y proyección del log
- `tests/sync.test.mjs` — que **cliente y servidor fusionen igual**; si se
  separan, un teléfono muestra una cosa y la base otra
- `tests/maestro.test.mjs` — los tres niveles de carga del maestro

Las pruebas de JS no reimplementan nada: extraen las funciones reales de
`app.js`, así que renombrar una también las rompe.

## Este repositorio es público

No se versionan: archivos `.xlsx` (llevan nombres y códigos de personal),
`tools/*.local.json` (conexión a Oracle y correcciones de nombres), ni ninguna
llave. `config.js` se sube con la llave **vacía** y la CI la rellena desde el
secreto `NFC_APP_KEY`.

Sobre esa llave, sin adornos: acaba dentro del APK y un `unzip` la revela. Es un
filtro contra curiosos, no un secreto. Lo que protege el histórico es que la
base solo crezca y que borrar exija `NFC_ADMIN_KEY`, que nunca sale de Vercel.
