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
Mini y midi aspersion (MNA, MDA), carrete (CAR), aspersion (ASP), avance
frontal (AVF) y pivote central (PVC). El carrete entro el 2026-08-24: se rotula
con el mismo recorrido por ramal que la mini aspersion, asi que ya no hay razon
para dejarlo fuera. Lo que quede de otro tipo -Oracle trae APO y GRA- el script
lo descarta y dice cuantos y de que tipo, para que se sepa que existen y que
quedaron fuera a proposito.

Cada modulo se lleva su regla escrita
-------------------------------------
MNA y MDA: ramales + 4 etiquetas, grabadas dos veces sobre dos juegos.
CAR:       un rotulo por ramal, grabado dos veces. Sin las 4 de repuesto.
ASP:       6 etiquetas fijas, una sola pasada. Los ramales no entran.
AVF y PVC: 2 etiquetas fijas, una sola pasada. Tampoco entran.

Esa regla viaja en el JSON (`pasadas`, `etiquetasExtra`, `etiquetasFijas`) en
vez de vivir solo dentro de la app, por lo mismo que los ramales: se corrige sin
reinstalar el APK en cada telefono. La app tambien sabe deducirla del tipo que
lleva el codigo, asi que un maestro viejo sin esos campos no manda a grabar de
mas.

Modulos que Oracle pierde de vista
----------------------------------
Perderle el codigo a un modulo no es darlo de baja. Cuando una fila aparece con
el CODIGO_MODULO vacio -pasa cuando se esta recodificando una finca- el modulo
se cae de la consulta y, si nadie lo evita, del maestro. Los rotulos que ya
estan pegados en el campo no se caen con el: el operador se queda con un modulo
a medio rotular que la app ya no sabe abrir.

La lista CONSERVADOS dice cuales se quedan de todas formas, copiados del maestro
anterior y con el motivo escrito al lado. Cada corrida los enumera, y el dia que
Oracle devuelva el codigo avisa de que la linea ya sobra.

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
from collections import Counter, defaultdict
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

# Modulos que se quedan en el maestro aunque Oracle ya no los tenga.
#
# No es lo mismo dar de baja un modulo que perderle el codigo. El 2026-08-20
# aparecieron en la tabla siete filas a las que alguien les vacio el
# CODIGO_MODULO -Oro Blanco I y Polonia se estan recodificando- y cinco de esos
# modulos tienen etiquetas pegadas en el campo. Sacarlos del maestro no borra
# esos rotulos: solo deja al operador sin poder abrir el modulo que tiene
# delante a medio rotular.
#
# Por eso se conservan tal como estaban en el maestro anterior, con el motivo
# escrito al lado. Es un parche a la vista y con fecha, no un dato inventado: el
# dia que Oracle devuelva el codigo, el modulo vuelve por la via normal y el
# script avisa de que la linea ya sobra.
CONSERVADOS = {
    # Villa Laura se quedo sin un solo codigo: sus tres filas estan en blanco y
    # ademas pasaron de Aspersion a Mini Aspersion. Ojo el dia que se los
    # devuelvan: como MNA la cuenta deja de ser 6 fijas y pasa a ramales + 4 en
    # dos pasadas, y los rotulos 001..006 que ya estan puestos no cuadrarian.
    'CEN-ASP-012': 'Oracle le vacio el codigo el 2026-08-20 (Villa Laura, la pasan a MNA); 6 etiquetas grabadas',
    'CEN-ASP-018': 'Oracle le vacio el codigo el 2026-08-20 (Villa Laura, la pasan a MNA); 6 etiquetas grabadas',
    'CEN-MNA-040': 'Oracle le vacio el codigo el 2026-08-20 (Luceros); 32 etiquetas grabadas',
    'CEN-PVC-001': 'Oracle le vacio el codigo el 2026-08-20 (Polonia, recodificacion)',
    'CEN-PVC-002': 'Oracle le vacio el codigo el 2026-08-20 (Polonia, recodificacion)',
    'CES-MNA-019': 'Oracle le vacio el codigo el 2026-08-20 (Oro Blanco I); 26 etiquetas grabadas',
    'CES-MNA-020': 'Oracle le vacio el codigo el 2026-08-20 (Oro Blanco I); 37 etiquetas grabadas',
    'CES-MNA-022': 'Oracle le vacio el codigo el 2026-08-20 (Oro Blanco I); 34 etiquetas grabadas',
    'CES-MNA-023': 'Oracle le vacio el codigo el 2026-08-20 (Oro Blanco I); 32 etiquetas grabadas',
}


def conservar_los_que_oracle_perdio(nuevos, viejos):
    """
    Devuelve al maestro los modulos de CONSERVADOS que Oracle ya no trae.

    Se copian del maestro ANTERIOR, no se inventan: sus ramales y su regla son
    los que ya tenian, que son los que describen las etiquetas que estan
    pegadas en el campo.
    """
    presentes = {m['codigo'] for m in nuevos}
    anteriores = {m['codigo']: m for m in viejos}
    recuperados, devueltos, perdidos = [], [], []

    for codigo, motivo in sorted(CONSERVADOS.items()):
        if codigo in presentes:
            devueltos.append(codigo)
            continue
        anterior = anteriores.get(codigo)
        if anterior is None:
            perdidos.append(codigo)
            continue
        nuevos.append({**anterior, 'conservado': motivo})
        recuperados.append(codigo)

    nuevos.sort(key=lambda m: m['codigo'])

    if recuperados:
        print(f'  {len(recuperados)} modulo(s) conservados del maestro anterior '
              f'porque Oracle ya no los trae:')
        for codigo in recuperados:
            print(f'    {codigo}: {CONSERVADOS[codigo]}')
    if devueltos:
        print(f'  {len(devueltos)} modulo(s) de CONSERVADOS volvieron a Oracle. '
              f'Ya se pueden quitar de la lista:')
        for codigo in devueltos:
            print(f'    {codigo}')
    for codigo in perdidos:
        # Ni Oracle ni el maestro anterior: no hay de donde copiarlo. Decirlo es
        # lo unico honesto; inventarle ramales seria mandar a grabar a ciegas.
        print(f'  AVISO: {codigo} esta en CONSERVADOS y no esta ni en Oracle ni '
              f'en el maestro anterior. No se puede conservar.')

    return recuperados


# Modulos que existen en Oracle con todos sus datos pero SIN CODIGO_MODULO, y a
# los que la oficina ya les asigno uno para poder rotularlos ya.
#
# La llave es el OBJECTID de la fila en SDEUSR.MAESTRO_MODULOS_RIEGO, no la
# finca ni el motor: es lo unico que identifica la fila sin ambiguedad cuando
# una misma finca tiene varias sin codigo. El codigo asignado se le pega a esa
# fila antes de armar el maestro, asi que de ahi en adelante el modulo recorre
# exactamente el mismo camino que cualquier otro -normalizacion de nombres,
# deduplicado, regla de etiquetas, diff- y no hay una segunda via por donde se
# pueda colar un modulo mal formado.
#
# Por que aqui y no escrito a mano en modulos.json: el maestro se regenera
# entero desde Oracle en cada corrida, asi que un modulo escrito a mano
# desaparece en la siguiente sin que nadie lo note. Aqui sobrevive, y sus datos
# siguen saliendo de Oracle: lo unico que pone esta tabla es el codigo.
#
# Esto es un puente, no un destino. Cuando alguien capture el codigo en Oracle,
# el script lo detecta y avisa de que ya se puede borrar de aqui.
#
# Los codigos salieron de tools/proponer_codigos_modulo.py y los reviso la
# oficina en Codigos_Pendientes.xlsx el 2026-08-24. De los 20 propuestos se
# dejaron estos 11: quedaron fuera los de Villa Laura (Oracle y el informe de
# equipos no coinciden en el tipo, y la finca tiene huerfanos), el bombeo por
# gravedad (BGR no es un tipo que la app rotule) y los cinco pivotes de Oro
# Blanco I (finca a medio recodificar).
PENDIENTES_EN_ORACLE = {
    3635: 'CES-MNA-081',   # El Rosario I I, motor 0033-1540, 11 ramales
    3587: 'CES-MDA-006',   # La Felicidad, motor 0033-0224, 2 ramales
    3590: 'CES-MNA-082',   # La Felicidad, motor 0043-0097, 2 ramales
    3601: 'CES-ASP-002',   # Morenas Fernandez, motor 0032-0066, 2 ramales
    3591: 'CES-ASP-003',   # Morenas Fernandez, motor 0032-0067, 2 ramales
    3602: 'CES-MNA-083',   # Morenas Fernandez, motor 0033-0531, 2 ramales
    3592: 'CES-PVC-010',   # Morenas Fernandez, motor 0033-0532, 2 ramales
    3570: 'OCR-PVC-018',   # Hacienda Magdalena, motor 0033-0833, 8 ramales
    3572: 'OCR-PVC-019',   # Rastunya II, motor 0033-0804, 9 ramales
    3571: 'OCR-CAR-003',   # Rastunya II, motor 0033-1615, 6 ramales
    3629: 'ORC-MNA-066',   # Chaparral, motor 0033-1572, 16 ramales
}


# Filas a las que Oracle SI les puso codigo, pero uno que ya esta ocupado por
# otro modulo. Aqui la oficina manda sobre Oracle, que es la excepcion a la
# regla de esta herramienta, asi que va en su propia tabla y no mezclada con las
# pendientes: son dos permisos distintos y conviene que se lean distinto.
#
# Un codigo repetido no es cosmetico. El maestro se queda con UNA de las dos
# filas -la mas completa- asi que el otro modulo desaparece de la app, y su
# gente ve en pantalla la finca del que gano. Renombrar al que sobra es lo que
# hace que los dos existan.
#
# Solo se recodifica cuando el codigo viejo NO tiene una sola etiqueta grabada.
# Con etiquetas pegadas en el campo un renombre las deja huerfanas: dicen
# CEN-PVC-003 y el maestro ya no sabe que es eso. Eso se comprueba abajo y corta
# la corrida si no se cumple.
RECODIFICADOS = {
    # El pivote de Polonia compartia CEN-PVC-003 con uno de Oro Blanco I. Polonia
    # pasa al siguiente libre de la serie (001 y 002 estan retirados pero cuentan,
    # 003 y 004 en uso). Serie CEN-PVC sin una sola etiqueta grabada al 2026-08-24,
    # asi que el renombre no deja rotulado huerfano.
    4056: ('CEN-PVC-005', 'CEN-PVC-003'),
}


def aplicar_recodificados(filas, rotulados):
    """
    Cambia el codigo de las filas que lo tienen repetido con otro modulo.

    `rotulados` es {codigo: etiquetas grabadas} o None si no se pudo consultar el
    registro. Sin esa consulta NO se recodifica nada: renombrar a ciegas es
    justo la operacion que puede dejar etiquetas huerfanas, y preferimos no
    tocar el maestro antes que tocarlo sin saber.
    """
    if not RECODIFICADOS:
        return []

    if rotulados is None:
        sys.exit('Hay recodificaciones pendientes y no se pudo consultar el registro '
                 'compartido. Sin saber que modulos tienen etiquetas grabadas no se '
                 'renombra nada.')

    por_objectid = {int(f['OBJECTID']): f for f in filas if f.get('OBJECTID') is not None}
    ocupados = {texto(f['CODIGO_MODULO']).upper() for f in filas}
    avisos = []

    for objectid, (nuevo, esperado) in sorted(RECODIFICADOS.items()):
        fila = por_objectid.get(objectid)
        if fila is None:
            print(f'  AVISO: la recodificacion a {nuevo} apuntaba al OBJECTID '
                  f'{objectid}, que ya no esta en Oracle. No se hizo nada.')
            continue

        actual = texto(fila['CODIGO_MODULO']).upper()
        if actual == nuevo:
            print(f'  {nuevo}: Oracle ya lo tiene asi. Quitalo de RECODIFICADOS.')
            continue
        if actual != esperado.upper():
            # Alguien ya lo movio a otra cosa: la premisa de la entrada dejo de
            # ser cierta y seguir seria pisar una decision mas nueva que esta.
            print(f'  AVISO: el OBJECTID {objectid} tenia {esperado} cuando se anoto '
                  f'esta recodificacion y hoy Oracle dice {actual or "(vacio)"}. '
                  f'No se recodifica; revisa la entrada.')
            continue
        if nuevo.upper() in ocupados:
            sys.exit(f'No se puede recodificar a {nuevo}: ese codigo ya esta en Oracle. '
                     f'Elige el siguiente libre de la serie.')
        # El peligro no es que el codigo viejo tenga etiquetas: es que DESAPAREZCA
        # teniendolas. En una recodificacion por codigo compartido casi siempre
        # hay otra fila que se queda con el -es la razon de ser de la entrada- y
        # entonces los rotulos pegados en el campo siguen apuntando a un modulo
        # que existe y con la misma cuenta de etiquetas. Solo cuando esta fila era
        # la ultima que lo llevaba el renombre deja las etiquetas sin dueno.
        grabadas = rotulados.get(actual, 0)
        otras = [f for f in filas if f is not fila
                 and texto(f['CODIGO_MODULO']).upper() == actual]
        if grabadas and not otras:
            sys.exit(f'No se recodifica {actual} -> {nuevo}: {actual} tiene {grabadas} '
                     f'etiqueta(s) grabadas y esta fila es la unica que lo lleva, asi '
                     f'que el codigo desapareceria del maestro y esos rotulos '
                     f'quedarian huerfanos en el campo.')

        fila['CODIGO_MODULO'] = nuevo
        ocupados.add(nuevo.upper())
        detalle = (f'{grabadas} etiqueta(s) de {actual} se quedan con '
                   f'{texto(otras[0]["FINCA"])}' if grabadas
                   else '0 etiquetas grabadas')
        print(f'  {esperado} -> {nuevo}: {texto(fila["FINCA"])} deja de compartir codigo '
              f'({detalle}).')
        avisos.append({'tipo': 'recodificado', 'de': esperado, 'a': nuevo,
                       'finca': texto(fila['FINCA'])})

    return avisos


def aplicar_pendientes(filas):
    """
    Le pega a cada fila pendiente el codigo que la oficina le asigno.

    Devuelve la lista de avisos. Se comprueban las tres cosas que pueden salir
    mal, porque las tres han pasado ya con datos de esta tabla:

    - La fila ya no esta (Oracle la borro): no hay nada que codificar.
    - La fila YA tiene codigo en Oracle: gana Oracle y la entrada sobra aqui.
      No se pisa nunca un codigo puesto en Oracle, aunque no sea el asignado:
      el maestro no es quien manda sobre el codigo de un modulo.
    - Dos entradas apuntando al mismo codigo: se corta, porque duplicar un
      codigo manda a dos modulos distintos a grabar el mismo rotulo.
    """
    avisos = []
    repetidos = [c for c, n in Counter(PENDIENTES_EN_ORACLE.values()).items() if n > 1]
    if repetidos:
        sys.exit(f'PENDIENTES_EN_ORACLE repite codigo(s): {", ".join(sorted(repetidos))}')

    por_objectid = {int(f['OBJECTID']): f for f in filas if f.get('OBJECTID') is not None}
    aplicados, ya_en_oracle, no_estan = [], [], []

    for objectid, codigo in sorted(PENDIENTES_EN_ORACLE.items(), key=lambda x: x[1]):
        fila = por_objectid.get(objectid)
        if fila is None:
            no_estan.append((objectid, codigo))
            continue
        if texto(fila['CODIGO_MODULO']):
            ya_en_oracle.append((codigo, texto(fila['CODIGO_MODULO'])))
            continue
        fila['CODIGO_MODULO'] = codigo
        aplicados.append(codigo)

    if aplicados:
        print(f'  {len(aplicados)} modulo(s) pendientes de capturar en Oracle, '
              f'con el codigo que les puso la oficina:')
        print(f'    {", ".join(aplicados)}')
        avisos.append({'tipo': 'pendienteEnOracle', 'codigos': aplicados})
    for codigo, en_oracle in ya_en_oracle:
        print(f'  {codigo}: Oracle ya trae esta fila con el codigo {en_oracle}. '
              f'Manda Oracle; quitala de PENDIENTES_EN_ORACLE.')
    for objectid, codigo in no_estan:
        print(f'  AVISO: {codigo} apuntaba al OBJECTID {objectid}, que ya no esta '
              f'en Oracle o no cumple la regla de entrada. No se codifico nada.')

    return avisos


QUERY = f"""
SELECT
    M.OBJECTID,
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

    # Antes de construir nada: las filas sin codigo a las que la oficina ya les
    # asigno uno lo reciben aqui, y de ahi en adelante son modulos normales.
    avisos_pendientes = aplicar_pendientes(filas)

    # El registro se consulta ANTES de construir, y no despues como antes, porque
    # recodificar exige saber que modulos tienen etiquetas grabadas: un renombre
    # con rotulos ya pegados los deja huerfanos. El resto del script lo sigue
    # usando igual, mas abajo.
    print('Consultando el registro compartido...')
    rotulados, motivo = modulos_con_etiquetas()
    if rotulados is not None:
        print(f'  {len(rotulados)} modulos con etiquetas grabadas')

    avisos_recodificados = aplicar_recodificados(filas, rotulados)

    nuevos, avisos, informe, dudosos = construir(filas, cfg)
    avisos = avisos_pendientes + avisos_recodificados + avisos

    viejo = json.loads(DESTINO.read_text(encoding='utf-8')) if DESTINO.exists() else {'modulos': []}
    viejos = viejo.get('modulos', [])

    conservar_los_que_oracle_perdio(nuevos, viejos)

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
