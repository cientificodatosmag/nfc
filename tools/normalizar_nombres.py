"""
Normalizacion de nombres del maestro de riego.

Vive aparte porque la usan dos generadores del mismo modulos.json: el que lee el
.xlsx (generar-modulos.py, en retirada) y el que lee Oracle
(actualizar-maestro.py). Que los dos apliquen exactamente las mismas reglas es
lo que permite comparar sus salidas y confiar en el diff.

Reglas acordadas al revisar el maestro:

  Fincas
    - Numeros romanos partidos en letras sueltas se unen: "I I I" -> "III".
      Conviven las dos convenciones en el archivo original.
    - Romanos en minuscula se pasan a mayuscula: "Iv" -> "IV".
    - Abreviaturas expandidas: Sta./Sto. -> Santa/Santo, Sn. -> San,
      Fco. -> Francisco, Agrop. -> Agropecuaria.

  Responsables
    - Se quita el prefijo de lista pegado al nombre: "1: Byron ..." -> "Byron ...".
    - Variantes del mismo nombre se unifican (ver `agrupar_por_parecido`).
"""
import re
import unicodedata
from difflib import SequenceMatcher

ABREVIATURAS = {
    'STA': 'Santa',
    'STO': 'Santo',
    'SN': 'San',
    'FCO': 'Francisco',
    'AGROP': 'Agropecuaria',
}

# Fusiones que ya estaban decididas antes de existir el parecido automatico. Se
# conservan porque son acuerdos, no deducciones: el automatismo podria dejar de
# proponerlas y la decision seguiria siendo esta.
FUSION_RESPONSABLES = {
    'EDDY ORELLANA': 'Eddy Leonardo Orellana Serrano',
}


def sin_acentos(texto):
    descompuesto = unicodedata.normalize('NFKD', texto or '')
    return ''.join(c for c in descompuesto if not unicodedata.combining(c))


def clave(texto):
    return ' '.join(sin_acentos(texto).upper().split())


def normalizar_simple(texto):
    """Colapsa espacios sin tocar nada mas."""
    return ' '.join((texto or '').split())


def normalizar_finca(nombre):
    palabras = (nombre or '').split()

    # Romanos escritos en minuscula o mezclados: Ii, Iv, Iii
    palabras = [p.upper() if re.fullmatch(r'[IiVv]{1,4}', p) and len(p) > 1 else p
                for p in palabras]

    # Romanos partidos en letras sueltas: ["I", "I", "I"] -> ["III"]
    unidas = []
    for palabra in palabras:
        if palabra in ('I', 'V') and unidas and re.fullmatch(r'[IV]+', unidas[-1]):
            unidas[-1] += palabra
        else:
            unidas.append(palabra)

    expandidas = []
    for palabra in unidas:
        raiz = clave(palabra).rstrip('.')
        expandidas.append(ABREVIATURAS.get(raiz, palabra) if palabra.endswith('.') else palabra)

    return ' '.join(expandidas)


def normalizar_responsable(nombre):
    limpio = re.sub(r'^\s*\d+\s*[:.\-]\s*', '', nombre or '')   # "3: Otto ..." -> "Otto ..."
    limpio = ' '.join(limpio.split())
    return FUSION_RESPONSABLES.get(clave(limpio), limpio)


# --------------------------------------------------------------- por parecido

# Umbral por PALABRA, no sobre el nombre entero.
#
# Comparar los nombres completos con un ratio de caracteres no funciona: entre
# "Mario Lopez Lopez" y "Mario Rodolfo Lopez Lopez" da 0.81, y entre "Jaime
# Cruz" y "Jaime de La Cruz" da 0.77. Cualquier umbral que acepte el primero
# acepta el segundo, y el segundo son dos personas. La longitud del segundo
# nombre omitido domina la medida y tapa lo que de verdad importa.
#
# Palabra a palabra si distingue: "Velasquez"/"Velazquez" es 0.94 (la misma
# persona mal escrita) mientras que "Lopez"/"Perez" es 0.4.
UMBRAL_PALABRA = 0.85


def _par(a, b):
    """Clave estable de un par, para buscarlo en las listas de decisiones."""
    return ' | '.join(sorted([clave(a), clave(b)]))


def _casan(pa, pb):
    """Dos palabras son la misma, tolerando una tilde perdida o una letra."""
    return pa == pb or SequenceMatcher(None, pa, pb).ratio() >= UMBRAL_PALABRA


def _contenido(cortos, largos):
    """
    ¿Aparecen todas las palabras del nombre corto dentro del largo, en orden?

    Es el patron de la abreviatura: se omiten segundos nombres o apellidos, pero
    los que quedan conservan su orden. "Mario Lopez Lopez" cabe dentro de "Mario
    Rodolfo Lopez Lopez"; "Mario Perez" no cabe en ninguno.
    """
    i = 0
    for palabra in cortos:
        while i < len(largos) and not _casan(palabra, largos[i]):
            i += 1
        if i == len(largos):
            return False
        i += 1
    return True


def parecidos(a, b):
    """
    ¿Son dos formas de escribir el mismo nombre?

    Tres condiciones, y las tres hacen falta:

      - El primer nombre casa. Dos personas con distinto nombre de pila no son
        la misma por mucho que compartan apellidos.
      - El ultimo apellido casa. Es el que casi nunca se omite.
      - Las palabras del nombre corto aparecen todas dentro del largo, en orden.

    Aun asi esto se equivoca, y por eso existe `nunca_fusionar`: "Jaime Cruz" y
    "Jaime de La Cruz" cumplen las tres y son dos personas distintas. Ninguna
    medida de parecido puede separarlas; solo saberlo. Que este metodo las
    detecte como parecidas no es un defecto, es lo que hace imprescindible la
    lista.
    """
    ka, kb = clave(a), clave(b)
    if not ka or not kb or ka == kb:
        return False

    ta, tb = ka.split(), kb.split()
    if not ta or not tb:
        return False
    if not _casan(ta[0], tb[0]) or not _casan(ta[-1], tb[-1]):
        return False

    cortos, largos = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    return _contenido(cortos, largos)


def agrupar_por_parecido(nombres, fusiones=None, nunca_fusionar=None):
    """
    Agrupa variantes del mismo nombre y elige una grafia por grupo.

    Devuelve (mapa, informe):
      mapa    -> {nombre tal cual venia: nombre elegido}
      informe -> lista de {elegido, variantes, motivo} para que nada se fusione
                 en silencio. Cada corrida imprime esto.

    Gana la grafia mas larga: entre "Mario Lopez" y "MARIO RODOLFO LOPEZ LOPEZ"
    la completa es la que sirve para identificar a la persona. A igual longitud
    manda el orden alfabetico, para que dos corridas den lo mismo.
    """
    fusiones = {clave(k): v for k, v in (fusiones or {}).items()}
    vetados = {_par(*p) for p in (nunca_fusionar or [])}

    unicos = sorted({normalizar_simple(n) for n in nombres if normalizar_simple(n)})

    grupos = []
    for nombre in unicos:
        for grupo in grupos:
            if any(parecidos(nombre, otro) and _par(nombre, otro) not in vetados
                   for otro in grupo):
                grupo.append(nombre)
                break
        else:
            grupos.append([nombre])

    mapa = {}
    informe = []
    for grupo in grupos:
        elegido = sorted(grupo, key=lambda n: (-len(n), n))[0]
        motivo = 'parecido'

        # Una fusion escrita a mano manda sobre la automatica.
        for variante in grupo:
            if clave(variante) in fusiones:
                elegido = fusiones[clave(variante)]
                motivo = 'decidido a mano'
                break

        for variante in grupo:
            mapa[variante] = elegido
        if len(grupo) > 1 or motivo == 'decidido a mano':
            informe.append({'elegido': elegido, 'variantes': grupo, 'motivo': motivo})

    return mapa, informe


def pares_dudosos(nombres, nunca_fusionar=None):
    """
    La zona gris: pares que comparten primer nombre y ultimo apellido pero que
    NO se fusionaron porque las palabras del medio no encajan.

    Se imprimen para que alguien decida, porque es justo donde el automatismo no
    debe decidir solo: o son la misma persona con un apellido intercalado
    distinto y falta una entrada en `fusiones_responsable`, o son dos personas y
    conviene dejarlo escrito en `nunca_fusionar` para que quede constancia.
    """
    vetados = {_par(*p) for p in (nunca_fusionar or [])}
    unicos = sorted({normalizar_simple(n) for n in nombres if normalizar_simple(n)})

    fuera = []
    for i, a in enumerate(unicos):
        for b in unicos[i + 1:]:
            if parecidos(a, b) or _par(a, b) in vetados:
                continue
            ta, tb = clave(a).split(), clave(b).split()
            if not ta or not tb:
                continue
            if _casan(ta[0], tb[0]) and _casan(ta[-1], tb[-1]):
                fuera.append((a, b, round(SequenceMatcher(None, clave(a), clave(b)).ratio(), 3)))
    return sorted(fuera, key=lambda x: -x[2])
