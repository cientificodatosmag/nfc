"""
Cuantas etiquetas lleva un modulo, en un solo sitio.

    from reglas_rotulado import regla, por_pasada, total_etiquetas

Hasta que aparecio la aspersion la respuesta era una sola -ramales + 4, dos
veces- y cada script se la sabia de memoria. Ya no. Dos reglas repartidas en
cinco archivos son cuatro sitios donde equivocarse, y equivocarse aqui significa
mandar a imprimir el doble de rotulos o dar por terminado un modulo a medias.

    MNA, MDA : ramales + 4 etiquetas, dos juegos.
    CAR      : un rotulo por ramal, dos juegos. Sin las 4 de repuesto.
    ASP      : 6 etiquetas fijas, un solo juego. No dependen de los ramales.
    AVF, PVC : 2 etiquetas fijas, un solo juego. Tampoco dependen.

Ninguno de los de cantidad fija se cuenta por ramal: un ASP lleva 6 y punto,
tenga el modulo 2 ramales u 8, y un pivote lleva 2. Por eso la regla no es solo
un "extra" que se suma: hay un tercer valor, `fijas`, que cuando esta puesto
manda sobre los ramales en vez de sumarse.

La regla se deduce del tipo de riego que lleva el propio codigo -OOC-ASP-001 es
aspersion, OOC-MNA-001 mini aspersion-, pero manda modulos.json cuando lo dice:
sus campos `pasadas`, `etiquetasExtra` y `etiquetasFijas` se corrigen sin tocar
codigo, igual que los ramales. Es la misma regla y el mismo orden de prioridad
que aplica app.js.
"""
import re

# tipo -> (pasadas, etiquetas extra por pasada, etiquetas fijas por pasada)
#
# `fijas` en None significa "cuenta los ramales y sumale el extra". Con un
# numero, ese numero es el total y los ramales no entran en la cuenta.
REGLAS = {
    'MDA': (2, 4, None),
    'MNA': (2, 4, None),
    # El carrete se recorre ramal por ramal y se graba dos veces, igual que la
    # mini aspersion, pero SIN las cuatro de repuesto: son pares exactos, un
    # rotulo por ramal en cada juego. Por eso comparte el `fijas` en None y se
    # separa de MNA solo en el extra. Ojo: con extra 0 la cuenta es los ramales
    # pelados, asi que un carrete al que Oracle le vacie los ramales se queda en
    # cero y no entra al maestro. Es a proposito: sin ramales no hay que grabar.
    'CAR': (2, 0, None),
    'ASP': (1, 0, 6),
    # Avance frontal y pivote central no son un juego de ramales que rotular uno
    # por uno: es una maquina sola, y lleva dos etiquetas en una pasada. Los
    # ramales no entran, que es justo lo que permite alcanzarlos a todos: buena
    # parte no los tiene llenos en Oracle y con la cuenta por ramales habrian
    # quedado fuera del maestro sin que nadie lo notara.
    'AVF': (1, 0, 2),
    'PVC': (1, 0, 2),
}
POR_DEFECTO = (2, 4, None)

# Como se llama cada tipo cuando hay que enseñarselo a alguien. Hoy son los
# mismos seis que la app rotula, pero las dos tablas siguen aparte a proposito:
# Oracle trae tipos que no estan en ninguna -APO, GRA- y un reporte que los deja
# en blanco obliga a adivinar si es un tipo raro o un dato faltante.
NOMBRES = {
    'MNA': 'Mini aspersion',
    'MDA': 'Midi aspersion',
    'ASP': 'Aspersion',
    'AVF': 'Avance frontal',
    'CAR': 'Carrete',
    'PVC': 'Pivote central',
}

# El formato guardado del avance nunca tuvo mas de dos pasadas.
MAX_PASADAS = 2

CODIGO_MODULO = re.compile(r'^([A-Z]{3})-([A-Z]{3})-(\d+)$')


def tipo_modulo(codigo):
    """El tipo de riego que declara el codigo, o None si no tiene esa forma."""
    m = CODIGO_MODULO.match(str(codigo or '').strip().upper())
    return m.group(2) if m else None


def _entero(valor, minimo):
    """El valor si es un entero valido de verdad, o None. Los bool no cuentan."""
    if isinstance(valor, bool) or not isinstance(valor, int):
        return None
    return valor if valor >= minimo else None


def regla(codigo, modulo=None):
    """
    (pasadas, extra, fijas) de un modulo. `modulo` es su entrada de
    modulos.json, si se tiene; lo que ella diga manda sobre lo que deduce el
    codigo.

    Un valor imposible en el JSON no se obedece: se cae al del tipo. Preferir
    un cero mal escrito antes que la regla conocida seria dar por completo un
    modulo sin una sola etiqueta grabada.
    """
    pasadas, extra, fijas = REGLAS.get(tipo_modulo(codigo), POR_DEFECTO)
    if modulo:
        p = _entero(modulo.get('pasadas'), 1)
        if p is not None and p <= MAX_PASADAS:
            pasadas = p
        e = _entero(modulo.get('etiquetasExtra'), 0)
        if e is not None:
            extra = e
        f = _entero(modulo.get('etiquetasFijas'), 1)
        if f is not None:
            fijas = f
    return pasadas, extra, fijas


def pasadas_y_extra(codigo, modulo=None):
    """Compatibilidad: los dos primeros valores de regla()."""
    pasadas, extra, _ = regla(codigo, modulo)
    return pasadas, extra


def por_pasada(codigo, ramales, modulo=None):
    """
    Etiquetas de UNA pasada.

    Con etiquetas fijas ni siquiera se miran los ramales: un ASP lleva sus 6
    aunque Oracle no sepa cuantos ramales tiene.
    """
    _, extra, fijas = regla(codigo, modulo)
    if fijas is not None:
        return fijas
    if ramales is None:
        return 0
    return int(ramales) + extra


def total_etiquetas(codigo, ramales, modulo=None):
    """Etiquetas fisicas del modulo entero: cada pasada por sus etiquetas."""
    return por_pasada(codigo, ramales, modulo) * pasadas_de(codigo, modulo)


def pasadas_de(codigo, modulo=None):
    return regla(codigo, modulo)[0]


def nombre_tipo(codigo):
    """
    El tipo de riego para una columna de Excel: "ASP - Aspersion".

    Lleva la sigla delante a proposito: es la que aparece en el codigo del
    modulo y la que decide cuantas etiquetas se graban, asi que filtrar por ella
    y filtrar por el nombre son la misma cosa. Un tipo que no esta en el
    catalogo sale con su sigla sola en vez de en blanco: que Oracle traiga uno
    nuevo es un dato, no un hueco.
    """
    tipo = tipo_modulo(codigo)
    if not tipo:
        return ''
    nombre = NOMBRES.get(tipo)
    return f'{tipo} - {nombre}' if nombre else tipo
