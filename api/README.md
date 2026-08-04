# Registro compartido de rotulado

API que permite que varios teléfonos sepan qué etiquetas ya se grabaron. La app
la usa desde el Paso 3: ver [`sync.js`](../sync.js) para el lado del cliente.

## Cómo está pensado

Es un **log append-only**: nunca se actualiza ni se borra una fila. Lo que ve la
app es una *proyección* calculada sobre ese log, reconstruible desde cero.

Esa decisión es la que hace que:

- dos teléfonos que trabajaron sin señal converjan al mismo resultado sin
  importar en qué orden sincronicen;
- reintentar una subida tras un corte de red no duplique nada (la clave única
  sobre `evento_id` es toda la idempotencia);
- cualquier destrozo sea reversible con SQL mirando `recibido_en`.

## Puesta en marcha

### 1. Base de datos

En el panel de Vercel: **Storage → Create Database → Neon (Postgres)**, y
conéctala al proyecto. La integración deja `DATABASE_URL` en las variables de
entorno. El código acepta también `POSTGRES_URL`.

### 2. Variables de entorno

En **Settings → Environment Variables** del proyecto:

| Variable | Para qué | Dónde vive |
|---|---|---|
| `NFC_APP_KEY` | La usa la app. Leer y escribir eventos. | Acabará dentro del APK |
| `NFC_ADMIN_KEY` | Borrados y exportación completa. | **Solo aquí. Nunca en el APK** |

Genera cada una con algo así:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Que sean **dos llaves distintas** es el punto: `NFC_APP_KEY` viaja en el APK y
un `unzip` la revela en diez segundos, así que no es un secreto — es un filtro
contra curiosos. Lo que protege el histórico es que borrar exija la otra, que
nunca sale del servidor.

### 3. Crear el esquema

Una sola vez, tras el primer despliegue:

```bash
curl -X POST https://<proyecto>.vercel.app/api/migrar \
     -H "x-admin-key: $NFC_ADMIN_KEY"
```

No se ejecuta solo en cada arranque a propósito: una tabla que se crea sola
esconde el momento en que el esquema cambia.

## Endpoints

### `GET /api/salud`

Distingue "no hay señal" de "el servidor está caído", y devuelve la hora del
servidor para que el cliente corrija el desfase de su propio reloj.

```bash
curl https://<proyecto>.vercel.app/api/salud -H "x-app-key: $NFC_APP_KEY"
```

### `POST /api/eventos`

Sube un lote (máximo 200). Repetible sin miedo.

```bash
curl -X POST https://<proyecto>.vercel.app/api/eventos \
  -H "x-app-key: $NFC_APP_KEY" -H "content-type: application/json" \
  -d '{"eventos":[{
        "id":"prueba-1","tipo":"grabada","modulo":"OOC-MNA-001",
        "pasada":1,"numero":7,"texto":"OOC-MNA-001-007","uid":"04:A2:B3:C4",
        "fecha":"2026-08-04T15:00:00.000Z","dispositivoId":"d-prueba",
        "totalPasada":16,"region":"OCCIDENTE CENTRO",
        "responsable":"Fulano","finca":"Alamos"}]}'
```

Responde `{aceptados, duplicados, rechazados, seq, serverTime}`.

**Para el cliente, `duplicados` cuenta igual que `aceptados`**: significa que ya
estaba guardado, así que puede sacarlo de la cola sin perderlo. Solo un
`rechazado` indica un evento que jamás se aceptará y hay que apartar, porque si
no bloquearía la cola para siempre.

### `GET /api/eventos?desde=<seq>&limite=<n>`

Baja lo nuevo a partir de un cursor. Grabaciones y reinicios van en un solo
flujo ordenado por `seq`, de modo que no hay ambigüedad sobre cuál ocurrió antes.

```bash
curl "https://<proyecto>.vercel.app/api/eventos?desde=0" -H "x-app-key: $NFC_APP_KEY"
```

## Comprobación de que quedó bien

```bash
# 1. Repetir el mismo POST dos veces.
#    La primera: aceptados=["prueba-1"], duplicados=[]
#    La segunda: aceptados=[],           duplicados=["prueba-1"]
#    Si la segunda inserta una fila nueva, la idempotencia está rota.

# 2. Un evento inválido debe salir en 'rechazados', no tumbar el lote:
curl -X POST .../api/eventos -H "x-app-key: $NFC_APP_KEY" \
  -H "content-type: application/json" \
  -d '{"eventos":[{"id":"malo","modulo":"NO-VALIDO","pasada":9,"numero":0,
                   "fecha":"2026-08-04T15:00:00Z","dispositivoId":"d-x"}]}'

# 3. Sin llave debe dar 401:
curl -i .../api/salud

# 4. El preflight debe contestar 204 con Access-Control-Allow-Origin:
curl -i -X OPTIONS .../api/eventos \
  -H "Origin: https://localhost" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: x-app-key"
```

### `POST /api/reset` — llave de admin

Reinicia el avance de un módulo para **todos** los teléfonos. No borra ninguna
fila: añade una barrera con la marca de tiempo **del servidor**.

Que la fecha la ponga el servidor es la parte que importa. Con la del cliente,
un teléfono con el reloj adelantado podría borrar trabajo que todavía no se ha
hecho, y con uno atrasado el reinicio no surtiría efecto.

```bash
curl -X POST https://<proyecto>.vercel.app/api/reset \
  -H "x-admin-key: $NFC_ADMIN_KEY" -H "content-type: application/json" \
  -d '{"modulo":"OOC-MNA-001","pasada":null,
       "confirmacion":"OOC-MNA-001","motivo":"se mojaron las etiquetas"}'
```

`confirmacion` tiene que repetir el código. Es fricción deliberada: el error que
se quiere evitar no es teclear mal, es reiniciar el módulo equivocado.

Responde cuántas etiquetas dejan de contar. **La app no puede llamar aquí**: su
llave sale del APK con un `unzip`, y un reinicio manda a rotular de nuevo un
módulo entero.

### `GET /api/csv` — llave de admin

```bash
curl "https://<proyecto>.vercel.app/api/csv" -H "x-admin-key: $NFC_ADMIN_KEY" -o detalle.csv
curl "https://<proyecto>.vercel.app/api/csv?vista=resumen" -H "x-admin-key: $NFC_ADMIN_KEY"
curl "https://<proyecto>.vercel.app/api/csv?modulo=OOC-MNA-001" -H "x-admin-key: $NFC_ADMIN_KEY"
```

Existe aparte del botón de la app porque el teléfono exporta lo que *ese*
teléfono tiene, que es correcto pero parcial si alguno lleva días sin
sincronizar. Esto exporta lo que hay en la base.

Lleva BOM y saltos CRLF para que Excel en Windows no destroce los acentos de los
nombres de finca, y una columna `Duplicado`.

## Desde una PC, sin curl

`tools/administrar.py` envuelve todo lo anterior:

```bash
python tools/administrar.py estado
python tools/administrar.py duplicados
python tools/administrar.py csv --vista resumen
python tools/administrar.py reiniciar OOC-MNA-001 --pasada 2
```

## Cómo se limpian los datos de prueba

No hay borrado, y es a propósito. Para hacer desaparecer un módulo de lo que ven
los teléfonos se **añade** un evento `reset` por pasada: la proyección descarta
todo lo anterior a esa fecha y las filas siguen ahí para auditar.

```bash
curl -X POST https://<proyecto>.vercel.app/api/eventos \
  -H "x-app-key: $NFC_APP_KEY" -H "content-type: application/json" \
  -d '{"eventos":[
       {"id":"limpieza-p1","tipo":"reset","modulo":"ZZZ-TST-999","pasada":1,
        "numero":1,"fecha":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","dispositivoId":"d-limpieza"},
       {"id":"limpieza-p2","tipo":"reset","modulo":"ZZZ-TST-999","pasada":2,
        "numero":1,"fecha":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","dispositivoId":"d-limpieza"}]}'
```

Así se limpiaron los eventos de `ZZZ-TST-999` que dejaron las pruebas: el log
conserva sus filas y la proyección queda vacía.

## Etiquetas repetidas

Cuando dos teléfonos graban la misma clave `(modulo, pasada, numero)`, eso
significa que existen **dos etiquetas físicas con el mismo texto** pegadas en el
campo. No se esconde: el last-write-wins decide cuál mostrar, pero la clave sale
marcada en `duplicados`, en la columna `Duplicado` del CSV y en rojo en la tabla
de avance de la app.

Un duplicado sobre una clave que un reinicio borró deja de reportarse: la
proyección cuenta lo que hay ahora.
