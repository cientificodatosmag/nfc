"""
Genera modulos.json desde Oracle, pero solo despues de ensenar lo que cambia.

    python tools/actualizar-maestro.py              # muestra el diff y pregunta
    python tools/actualizar-maestro.py --solo-ver   # nunca escribe
    python tools/actualizar-maestro.py --si         # escribe sin preguntar
    python tools/actualizar-maestro.py --si --commit

El .xlsx sale del circuito: SDEUSR.MAESTRO_MODULOS_RIEGO es esa misma tabla.

Por que se pregunta antes de escribir
-------------------------------------
Un cambio en el numero de ramales de un modulo que YA tiene etiquetas grabadas
deja rotulado huerfano: las etiquetas fisicas dicen 001..N y el maestro pasa a
esperar otra cantidad. No es reversible con un git revert, porque las etiquetas
ya estan pegadas en el campo. Por eso el diff se mira antes, y por eso el script
consulta el registro compartido para saber cuales de esos modulos estan en
juego de verdad.

Por que no hay tarea programada
-------------------------------
GitHub Actions no alcanza la IP interna de Oracle. Cualquier automatizacion
tiene que correr desde dentro de la red. El push si dispara Vercel y la
recompilacion del APK, que es lo unico que necesita estar en la nube.

Que entra en la app
-------------------
Mini y midi aspersion (MNA, MDA), aspersion (ASP), avance frontal (AVF) y
pivote central (PVC). Solo el carrete (CAR) sigue fuera: se rotula con otro
procedimiento y la app no lo sabe hacer. El script lo descarta y dice cuantos y
de que tipo, para que se sepa que existen y que quedaron fuera a proposito.

Cada modulo se lleva su regla escrita
-------------------------------------
MNA y MDA: ramales + 4 etiquetas, grabadas dos veces sobre dos juegos.
ASP:       6 etiquetas fijas, una sola pasada. Los ramales no entran.
AVF y PVC: 2 etiquetas fijas, una sola pasada. Tampoco entran.

Esa regla viaja en el JSON (`pasadas`, `etiquetasExtra`, `etiquetasFijas`) en
vez de vivir solo dentro de la app, por lo mismo que los ramales: se corrige sin
reinstalar el APK en cada telefono. La app tambien sabe deducirla del tipo que
lleva el codigo, asi que un maestro viejo sin esos campos no manda a grabar de
mas.

Que exige "actualizado"
-----------------------
NO_RAMALES no nulo y mayor que cero, SALVO en los tipos de cantidad fija. Se
comprobo contra la realidad: exigir mas campos (responsable, finca, region,
hidrantes, area) mueve el total de 121 a 119 y no recupera ni descarta ninguno
de los 59 que ya se rotulaban.

La excepcion no es un capricho. Esa regla existe porque los ramales eran el
unico dato del que dependia cuantas etiquetas se graban: sin ellos no se sabia
que mandar a rotular. En aspersion ya no dependen -son 6 fijas-, ni en avance
frontal y pivote -2-, asi que exigirlos solo dejaba fuera modulos que se pueden
rotular perfectamente. Uno de esos tipos sin ramales entra con `ramales: 0` y su
cantidad fija, y el dia que Oracle le ponga los ramales no cambiara ni una. Es
lo que permite que entren TODOS los AVF y PVC que Oracle conoce, incluidos los
que nadie termino de llenar.
"""
import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

import _config
from normalizar_nombres import (
    agrupar_por_parecido, clave, normalizar_finca, normalizar_responsable,
    normalizar_simple, pares_dudosos,
)
from reglas_rotulado import NOMBRES, REGLAS, regla, tipo_modulo

RAIZ = Path(__file__).resolve().parent.parent
DESTINO = RAIZ / 'modulos.json'

REGLA_ACTUALIZADO = "M.NO_RAMALES IS NOT NULL AND M.NO_RAMALES > 0"

# Los tipos que llevan una cantidad fija de etiquetas no necesitan ramales para
# entrar: sus rotulos no salen de ahi. La lista se deduce de las reglas, asi que
# el dia que otro tipo pase a cantidad fija entra solo, sin tocar esta consulta.
TIPOS_SIN_RAMALES = sorted(t for t, (_, _, fijas) in REGLAS.items() if fijas is not None)
REGLA_CANTIDAD_FIJA = (
    "REGEXP_LIKE(M.CODIGO_MODULO, '^[A-Z]{3}-(" + '|'.join(TIPOS_SIN_RAMALES) + ")-[0-9]+$')"
)
REGLA_ENTRADA = f"(({REGLA_ACTUALIZADO}) OR ({REGLA_CANTIDAD_FIJA}))"

# Los unicos que la app sabe rotular, con su (pasadas, extras, fijas). El
# codigo lleva el tipo de riego en el segundo bloque: ORC-MNA-001 es mini
# aspersion, ORC-ASP-001 es aspersion. La regla vive en reglas_rotulado.py, que
# es de donde la leen tambien los reportes.
TIPOS_APP = REGLAS

# Lo que queda fuera se graba con otro procedimiento, no con el de la app. Los
# nombres salen del mismo catalogo que usan los reportes.
TIPOS_FUERA = {t: n for t, n in NOMBRES.items() if t not in TIPOS_APP}


QUERY = f"""
SELECT
    M.CODIGO_MODULO,
    M.REGION,
    M.RESPONSABLE,
    M.FINCA,
    M.C_FINCA,
    M.NO_RAMALES,
    M.TIPO_RIEGO,
    M.FUENTE_AGUA,
    M.NO_HIDRANTES,
    M.AREA_MODULO
FROM
    SDEUSR.MAESTRO_MODULOS_RIEGO M
WHERE
    {REGLA_ENTRADA}
ORDER BY
    M.CODIGO_MODULO
"""


# ------------------------------------------------------------------ Oracle

def leer_oracle():
    with _config.abrir_oracle() as con:
        cur = con.cursor()
        cur.execute(QUERY)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, fila)) for fila in cur]


def texto(valor):
    """
    Valor de Oracle -> texto para el JSON.

    Los NUMBER llegan como float o Decimal, asi que un str() directo convierte
    el codigo de finca 577 en "577.0". Parece cosmetico y no lo es: ese codigo
    se compara contra el del maestro anterior, y con el sufijo los 59 modulos
    que ya existian aparecian los 59 como "cambiados".
    """
    if valor is None:
        return ''
    if isinstance(valor, (int, float, Decimal)) and not isinstance(valor, bool):
        entero = int(valor)
        return str(entero) if valor == entero else str(valor)
    return normalizar_simple(str(valor))


def fila_representante(repetidas):
    """
    De varias filas con el mismo codigo de modulo, cual manda.

    Gana la mas completa, y a igualdad la menor en orden alfabetico de todos sus
    campos. Lo importante no es cual gane sino que gane SIEMPRE la misma: una
    consulta a Oracle no garantiza el orden de las filas empatadas, asi que
    quedarse con la primera que llega hace que dos corridas seguidas produzcan
    archivos distintos y un commit que no cambia nada real.
    """
    def peso(fila):
        llenos = sum(1 for v in fila.values() if texto(v))
        return (-llenos, tuple(texto(fila[c]) for c in sorted(fila)))

    return sorted(repetidas, key=peso)[0]


def construir(filas, cfg):
    """Filas de Oracle -> lista de modulos lista para el JSON, mas los avisos."""
    avisos = []
    por_codigo = defaultdict(list)
    sin_codigo = 0
    otros_tipos = defaultdict(list)

    for fila in filas:
        codigo = texto(fila['CODIGO_MODULO']).upper()
        if not codigo:
            sin_codigo += 1
            continue
        tipo = tipo_modulo(codigo)
        if tipo not in TIPOS_APP:
            otros_tipos[tipo or '(codigo raro)'].append(codigo)
            continue
        por_codigo[codigo].append(fila)

    if sin_codigo:
        avisos.append({'tipo': 'sinCodigo', 'registros': sin_codigo})
        print(f'  AVISO: {sin_codigo} fila(s) sin codigo de modulo, descartadas')

    if otros_tipos:
        cuantos = sum(len(v) for v in otros_tipos.values())
        # Solo el conteo: modulos.json viaja dentro del APK y la lista entera
        # de lo que no entra no le sirve de nada al telefono.
        avisos.append({'tipo': 'otroTipoDeRiego',
                       'registros': cuantos,
                       'porTipo': {t: len(set(c)) for t, c in otros_tipos.items()}})
        print(f'  {cuantos} fila(s) de otro tipo de riego, fuera de la app:')
        for tipo in sorted(otros_tipos):
            codigos = sorted(set(otros_tipos[tipo]))
            print(f'    {tipo} ({TIPOS_FUERA.get(tipo, "?")}): {len(codigos)} '
                  f'-> {", ".join(codigos[:6])}{" ..." if len(codigos) > 6 else ""}')

    # El parecido se aplica SOLO a responsables. En fincas seria destructivo:
    # "Providencia I" y "Providencia II" se parecen muchisimo y son dos fincas
    # distintas. Ahi mandan las reglas deterministas de romanos y abreviaturas.
    crudos = [normalizar_responsable(texto(f['RESPONSABLE']))
              for filas_mod in por_codigo.values() for f in filas_mod]
    mapa_resp, informe = agrupar_por_parecido(
        crudos, cfg['fusiones_responsable'], cfg['nunca_fusionar'])
    dudosos = pares_dudosos(crudos, cfg['nunca_fusionar'])

    # Una sola grafia por clave para tipo de riego y fuente de agua: son
    # catalogos cortos y las variantes son solo de mayusculas. Se elige la
    # primera alfabeticamente, no la primera que aparezca: el orden de las filas
    # de Oracle no esta garantizado y eso haria que dos corridas seguidas
    # produjeran archivos distintos.
    variantes = {'TIPO_RIEGO': defaultdict(set), 'FUENTE_AGUA': defaultdict(set)}
    for filas_mod in por_codigo.values():
        for f in filas_mod:
            for campo in variantes:
                v = texto(f[campo])
                if v:
                    variantes[campo][clave(v)].add(v)
    canon_riego = {k: sorted(v)[0] for k, v in variantes['TIPO_RIEGO'].items()}
    canon_agua = {k: sorted(v)[0] for k, v in variantes['FUENTE_AGUA'].items()}

    modulos = []
    for codigo in sorted(por_codigo):
        repetidas = por_codigo[codigo]
        primera = fila_representante(repetidas)

        if len(repetidas) > 1:
            ramales_distintos = {int(r['NO_RAMALES'] or 0) for r in repetidas}
            difieren = sorted(c for c in primera
                              if len({texto(r[c]) for r in repetidas}) > 1)
            avisos.append({
                'codigo': codigo,
                'registros': len(repetidas),
                'columnasDistintas': difieren,
                'mismoNumeroDeRamales': len(ramales_distintos) == 1,
            })
            if len(ramales_distintos) > 1:
                print(f'  AVISO: {codigo} repetido CON ramales distintos '
                      f'{sorted(ramales_distintos)}; se usa {int(primera["NO_RAMALES"] or 0)}')

        responsable = normalizar_responsable(texto(primera['RESPONSABLE']))
        pasadas, extra, fijas = TIPOS_APP[tipo_modulo(codigo)]
        modulos.append({
            'codigo': codigo,
            'region': texto(primera['REGION']),
            'responsable': mapa_resp.get(responsable, responsable),
            'finca': normalizar_finca(texto(primera['FINCA'])),
            'codigoFinca': texto(primera['C_FINCA']),
            'ramales': int(primera['NO_RAMALES'] or 0),
            'pasadas': pasadas,
            'etiquetasExtra': extra,
            'etiquetasFijas': fijas,
            'tipoRiego': canon_riego.get(clave(texto(primera['TIPO_RIEGO'])), ''),
            'fuenteAgua': canon_agua.get(clave(texto(primera['FUENTE_AGUA'])), ''),
            'duplicado': len(repetidas) > 1,
        })

    return modulos, avisos, informe, dudosos


# ------------------------------------------------- registro compartido (opcional)

def modulos_con_etiquetas():
    """
    Modulos que ya tienen etiquetas grabadas, segun el registro compartido.

    Es opcional: sin llave el script sigue, solo que no puede distinguir un
    cambio de ramales inofensivo de uno que deja rotulado huerfano. Cuando no
    puede saberlo lo dice, en vez de callarse y dar una falsa tranquilidad.

    Aplica las mismas barreras de reinicio que el servidor: un modulo cuyo
    avance se reinicio no cuenta como rotulado.
    """
    llave = _config.llave_backend('NFC_APP_KEY', 'app')
    if not llave:
        return None, 'sin NFC_APP_KEY en el entorno ni en el llavero'

    base = ''
    cfg = RAIZ / 'config.js'
    if cfg.exists():
        for linea in cfg.read_text(encoding='utf-8').splitlines():
            if 'apiBase' in linea:
                base = linea.split("'")[1] if "'" in linea else ''
                break
    if not base:
        return None, 'no se encontro apiBase en config.js'

    eventos = []
    desde = 0
    try:
        for _ in range(20):
            pet = urllib.request.Request(
                f'{base.rstrip("/")}/api/eventos?desde={desde}&limite=1000',
                headers={'x-app-key': llave})
            with urllib.request.urlopen(pet, timeout=20) as r:
                datos = json.loads(r.read().decode('utf-8'))
            eventos.extend(datos.get('eventos', []))
            if not datos.get('hayMas'):
                break
            desde = datos.get('siguienteCursor', desde)
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        return None, f'no se pudo consultar el registro: {e}'

    barreras = defaultdict(dict)
    for e in eventos:
        if e.get('tipo') == 'reset':
            clv = e.get('pasada')
            previa = barreras[e['modulo']].get(clv)
            if not previa or e['fecha'] > previa:
                barreras[e['modulo']][clv] = e['fecha']

    cuenta = defaultdict(int)
    for e in eventos:
        if e.get('tipo') == 'reset':
            continue
        corte = barreras.get(e['modulo'], {}).get(e.get('pasada'))
        if corte and e['fecha'] <= corte:
            continue
        cuenta[e['modulo']] += 1

    return {m: n for m, n in cuenta.items() if n > 0}, None


# ---------------------------------------------------------------------- diff

def con_regla(modulo):
    """
    El modulo con su regla escrita, aunque no la traiga.

    Es lo que hace comparable el maestro anterior con el nuevo. Sin esto, la
    primera corrida despues de que estos campos existieran marcaria los 326
    modulos como "cambia el numero de etiquetas" -de None a 2 y de None a 4-
    cuando ninguno cambia de verdad, y ese aviso, gritado 326 veces, deja de
    significar nada el dia que uno cambie en serio.
    """
    pasadas, extra, _ = regla_de(modulo)
    # `etiquetasFijas` NO se rellena con el valor del tipo, al reves que las
    # otras dos. Un maestro escrito antes de que existiera el campo no queria
    # decir "las fijas de su tipo": queria decir que no habia fijas, porque el
    # concepto no existia. Rellenarlo aqui haria que el dia que a un tipo se le
    # pongan etiquetas fijas, el diff dijera que no cambio nada -y ese es
    # justamente el cambio que puede dejar rotulado huerfano.
    return {**modulo, 'pasadas': pasadas, 'etiquetasExtra': extra,
            'etiquetasFijas': modulo.get('etiquetasFijas')}


def cuenta_por_pasada(modulo):
    """
    Etiquetas de una pasada segun lo que ESE json dice, sin suponer nada.

    No usa reglas_rotulado.por_pasada a proposito: aquella rellena los huecos
    con la regla del tipo, que es lo correcto para leer un maestro, y aqui hace
    falta lo contrario -leer cada version tal como estaba escrita- para que el
    diff no se coma un cambio real.
    """
    m = con_regla(modulo)
    if m['etiquetasFijas'] is not None:
        return m['etiquetasFijas']
    return modulo['ramales'] + m['etiquetasExtra']


def juego_de(modulo):
    """(etiquetas por pasada, pasadas) del modulo. Es lo que se va a grabar."""
    return cuenta_por_pasada(modulo), con_regla(modulo)['pasadas']


def texto_juego(juego):
    etiquetas, pasadas = juego
    return f'{etiquetas} x{pasadas} = {etiquetas * pasadas}'


def comparar(viejos, nuevos):
    antes = {m['codigo']: con_regla(m) for m in viejos}
    ahora = {m['codigo']: con_regla(m) for m in nuevos}

    entran = sorted(set(ahora) - set(antes))
    salen = sorted(set(antes) - set(ahora))
    cambios = []
    for codigo in sorted(set(antes) & set(ahora)):
        difs = {k: (antes[codigo].get(k), ahora[codigo].get(k))
                for k in ahora[codigo]
                if antes[codigo].get(k) != ahora[codigo].get(k)}
        if difs:
            cambios.append((codigo, difs))
    return entran, salen, cambios


def regla_de(modulo):
    """
    (pasadas, extra, fijas) del modulo: lo que diga el JSON, y si no lo dice,
    su tipo.

    Ese respaldo por tipo es lo que hace comparable el maestro ANTERIOR, escrito
    antes de que estos campos existieran: sin el, el diff mostraria un salto de
    etiquetas que no ocurrio.
    """
    return regla(modulo['codigo'], modulo)


def etiquetas(modulos):
    """Etiquetas de UNA pasada."""
    return sum(cuenta_por_pasada(m) for m in modulos)


def etiquetas_fisicas(modulos):
    """Etiquetas de verdad: cada modulo por las pasadas que lleve."""
    return sum(cuenta_por_pasada(m) * con_regla(m)['pasadas'] for m in modulos)


def informar(viejos, nuevos, avisos, informe, dudosos, rotulados, motivo_sin_registro):
    entran, salen, cambios = comparar(viejos, nuevos)

    print()
    print('=' * 70)
    print(f'  {len(viejos)} modulos -> {len(nuevos)}      '
          f'etiquetas por pasada: {etiquetas(viejos)} -> {etiquetas(nuevos)}')
    print(f'  etiquetas fisicas (cada modulo por sus pasadas): '
          f'{etiquetas_fisicas(viejos)} -> {etiquetas_fisicas(nuevos)}')
    print('=' * 70)

    if informe:
        print(f'\nNOMBRES UNIFICADOS ({len(informe)})')
        for g in informe:
            otras = [v for v in g['variantes'] if v != g['elegido']]
            print(f'  {g["elegido"]}')
            for v in otras:
                print(f'      <- {v}   ({g["motivo"]})')

    if dudosos:
        print(f'\nPARECIDOS QUE NO SE FUSIONARON ({len(dudosos)}) — decide tu')
        print('  Si son la misma persona, anadela a fusiones_responsable.')
        print('  Si son dos personas, anade el par a nunca_fusionar.')
        for a, b, r in dudosos:
            print(f'  {r}  {a}   /   {b}')

    if entran:
        print(f'\nENTRAN ({len(entran)})')
        for c in entran:
            m = next(x for x in nuevos if x['codigo'] == c)
            pasadas, extra, fijas = regla_de(m)
            if fijas is not None:
                juego = f'{fijas} fijas x{pasadas}'
            elif extra:
                juego = f'{m["ramales"]}+{extra} x{pasadas}'
            else:
                juego = f'{m["ramales"]} x{pasadas}'
            print(f'  + {c}  {m["finca"]}  ramales {m["ramales"]}  '
                  f'({juego} etiquetas)  ({m["responsable"]})')

    if salen:
        print(f'\nSALEN ({len(salen)})')
        for c in salen:
            grabadas = (rotulados or {}).get(c, 0)
            marca = f'  <-- TIENE {grabadas} ETIQUETAS GRABADAS' if grabadas else ''
            print(f'  - {c}{marca}')

    peligrosos = []
    if cambios:
        por_codigo_antes = {m['codigo']: m for m in viejos}
        por_codigo_ahora = {m['codigo']: m for m in nuevos}
        print(f'\nCAMBIAN ({len(cambios)})')
        for codigo, difs in cambios:
            grabadas = (rotulados or {}).get(codigo, 0)

            # Lo peligroso no es que cambie un campo: es que cambie CUANTAS
            # etiquetas pide el modulo. Desde que la aspersion lleva cantidad
            # fija, a un ASP le pueden cambiar los ramales sin que eso mueva una
            # sola etiqueta, y gritar ahi enseña a ignorar el aviso.
            antes_cuenta = juego_de(por_codigo_antes[codigo])
            ahora_cuenta = juego_de(por_codigo_ahora[codigo])
            cambia_la_cuenta = antes_cuenta != ahora_cuenta

            for campo, (antes_v, ahora_v) in difs.items():
                print(f'  ~ {codigo}  {campo}: {antes_v!r} -> {ahora_v!r}')
            if cambia_la_cuenta:
                marca = f'   <-- YA TIENE {grabadas} ETIQUETAS GRABADAS' if grabadas else ''
                print(f'      etiquetas: {texto_juego(antes_cuenta)} -> '
                      f'{texto_juego(ahora_cuenta)}{marca}')
                if grabadas:
                    peligrosos.append((codigo, antes_cuenta, ahora_cuenta, grabadas))

    for aviso in avisos:
        if 'codigo' in aviso:
            print(f'\n  duplicado en Oracle {aviso["codigo"]}: {aviso["registros"]} registros, '
                  f'difieren en {aviso["columnasDistintas"]}')

    if rotulados is None:
        print(f'\n  NOTA: no se pudo consultar el registro compartido ({motivo_sin_registro}).')
        print('        No se puede saber que modulos ya tienen etiquetas grabadas,')
        print('        asi que un cambio de ramales peligroso pasaria sin aviso.')
        if 'NFC_APP_KEY' in motivo_sin_registro:
            print('        Para comprobarlo, deja puesta la llave:')
            for linea in _config.como_guardar_llave('NFC_APP_KEY', 'app').splitlines():
                print(f'        {linea}')
        else:
            print('        Si el diff toca ramales, vuelve a intentarlo antes de escribir.')
    elif peligrosos:
        print('\n' + '!' * 70)
        print('  CAMBIA EL NUMERO DE ETIQUETAS EN MODULOS YA ROTULADOS')
        print('  Las etiquetas fisicas dicen 001..N y el maestro va a esperar otra')
        print('  cantidad. Eso no se arregla con un git revert.')
        for codigo, antes_j, ahora_j, n in peligrosos:
            print(f'    {codigo}: {texto_juego(antes_j)} -> {texto_juego(ahora_j)}, '
                  f'con {n} etiquetas ya grabadas')
        print('!' * 70)

    if not (entran or salen or cambios):
        print('\nSin cambios. El maestro ya esta al dia.')

    return bool(entran or salen or cambios), peligrosos


# ---------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--solo-ver', action='store_true', help='muestra el diff y no escribe nada')
    ap.add_argument('--si', action='store_true', help='no preguntar antes de escribir')
    ap.add_argument('--commit', action='store_true', help='ademas hacer commit y push')
    args = ap.parse_args()

    cfg = _config.normalizaciones()

    print('Consultando Oracle...')
    filas = leer_oracle()
    print(f'  {len(filas)} filas cumplen la regla ({REGLA_ENTRADA})')

    nuevos, avisos, informe, dudosos = construir(filas, cfg)

    viejo = json.loads(DESTINO.read_text(encoding='utf-8')) if DESTINO.exists() else {'modulos': []}
    viejos = viejo.get('modulos', [])

    print('Consultando el registro compartido...')
    rotulados, motivo = modulos_con_etiquetas()
    if rotulados is not None:
        print(f'  {len(rotulados)} modulos con etiquetas grabadas')

    hay_cambios, peligrosos = informar(viejos, nuevos, avisos, informe, dudosos, rotulados, motivo)

    if args.solo_ver:
        return 0
    if not hay_cambios:
        return 0

    if not args.si:
        if peligrosos:
            print('\nHay modulos ya rotulados a los que les cambia el numero de etiquetas.')
        respuesta = input('\n¿Escribir modulos.json con estos cambios? [s/N] ').strip().lower()
        if respuesta not in ('s', 'si', 'sí'):
            print('No se escribio nada.')
            return 1

    salida = {
        'generado': date.today().isoformat(),
        'fuente': f'Oracle SDEUSR.MAESTRO_MODULOS_RIEGO ({datetime.now(timezone.utc):%Y-%m-%dT%H:%MZ})',
        'regla': REGLA_ENTRADA,
        'avisos': avisos,
        'modulos': nuevos,
    }
    DESTINO.write_text(json.dumps(salida, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'\nEscrito {DESTINO} con {len(nuevos)} modulos.')

    if not args.commit:
        print('Revisa con "git diff modulos.json" y sube cuando quieras.')
        return 0

    # El push es lo que publica: redespliega Vercel (los telefonos toman el
    # maestro al abrir o al sincronizar a mano) y recompila el APK.
    mensaje = (f'Actualizar el maestro desde Oracle: {len(nuevos)} modulos\n\n'
               f'Regla: {REGLA_ENTRADA}\n'
               f'{etiquetas(nuevos)} etiquetas por pasada, '
               f'{etiquetas_fisicas(nuevos)} fisicas.\n')
    subprocess.run(['git', 'add', 'modulos.json'], cwd=RAIZ, check=True)
    subprocess.run(['git', 'commit', '-m', mensaje], cwd=RAIZ, check=True)
    subprocess.run(['git', 'push'], cwd=RAIZ, check=True)
    print('Subido. Vercel y el APK se reconstruyen solos.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
