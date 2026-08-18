"""
Cuantas etiquetas lleva un modulo, en un solo sitio.

    from reglas_rotulado import pasadas_y_extra, por_pasada, total_etiquetas

Hasta que aparecio la aspersion la respuesta era una sola -ramales + 4, dos
veces- y cada script se la sabia de memoria. Ya no: un ASP lleva una etiqueta
por ramal, sin extras, y se graba una sola vez. Dos reglas repartidas en cinco
archivos son cuatro sitios donde equivocarse, y equivocarse aqui significa
mandar a imprimir el doble de rotulos o dar por terminado un modulo a medias.

La regla se deduce del tipo de riego que lleva el propio codigo -OOC-ASP-001 es
aspersion, OOC-MNA-001 mini aspersion-, pero manda modulos.json cuando lo dice:
sus campos `pasadas` y `etiquetasExtra` se corrigen sin tocar codigo, igual que
los ramales. Es la misma regla y el mismo orden de prioridad que aplica app.js.
"""
import re

# tipo -> (pasadas, etiquetas extra por pasada)
REGLAS = {
    'MDA': (2, 4),
    'MNA': (2, 4),
    'ASP': (1, 0),
}
POR_DEFECTO = (2, 4)

# El formato guardado del avance nunca tuvo mas de dos pasadas.
MAX_PASADAS = 2

CODIGO_MODULO = re.compile(r'^([A-Z]{3})-([A-Z]{3})-(\d+)$')


def tipo_modulo(codigo):
    """El tipo de riego que declara el codigo, o None si no tiene esa forma."""
    m = CODIGO_MODULO.match(str(codigo or '').strip().upper())
    return m.group(2) if m else None


def pasadas_y_extra(codigo, modulo=None):
    """
    (pasadas, extra) de un modulo. `modulo` es su entrada de modulos.json, si
    se tiene; lo que ella diga manda sobre lo que deduce el codigo.

    Un valor imposible en el JSON no se obedece: se cae al del tipo. Preferir
    un cero mal escrito antes que la regla conocida seria dar por completo un
    modulo sin una sola etiqueta grabada.
    """
    pasadas, extra = REGLAS.get(tipo_modulo(codigo), POR_DEFECTO)
    if modulo:
        p = modulo.get('pasadas')
        if isinstance(p, int) and not isinstance(p, bool) and 1 <= p <= MAX_PASADAS:
            pasadas = p
        e = modulo.get('etiquetasExtra')
        if isinstance(e, int) and not isinstance(e, bool) and e >= 0:
            extra = e
    return pasadas, extra


def por_pasada(codigo, ramales, modulo=None):
    """Etiquetas de UNA pasada, o 0 si no se sabe cuantos ramales tiene."""
    if ramales is None:
        return 0
    return int(ramales) + pasadas_y_extra(codigo, modulo)[1]


def total_etiquetas(codigo, ramales, modulo=None):
    """Etiquetas fisicas del modulo entero: cada pasada por sus etiquetas."""
    pasadas, _ = pasadas_y_extra(codigo, modulo)
    return por_pasada(codigo, ramales, modulo) * pasadas


def pasadas_de(codigo, modulo=None):
    return pasadas_y_extra(codigo, modulo)[0]
