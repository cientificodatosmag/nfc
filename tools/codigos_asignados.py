"""
Codigos que la oficina asigno y que Oracle todavia no refleja, en un solo sitio.

    from codigos_asignados import aplicar_a_filas, codigo_de

Existen dos situaciones distintas y por eso son dos tablas, no una:

- PENDIENTES_EN_ORACLE: la fila no tiene CODIGO_MODULO. Se le pone el que la
  oficina asigno. No se le quita el sitio a nadie.
- RECODIFICADOS: la fila SI tiene codigo, pero uno que ya lleva otro modulo.
  Aqui la oficina manda sobre Oracle, que es la excepcion a la regla de estas
  herramientas, y por eso se lee aparte: son dos permisos distintos.

Ambas van indexadas por el OBJECTID de la fila en SDEUSR.MAESTRO_MODULOS_RIEGO,
no por finca ni por motor: es lo unico que identifica la fila sin ambiguedad
cuando una misma finca tiene varias.

Por que este archivo existe
---------------------------
Estas tablas vivian dentro de actualizar-maestro.py, asi que solo las conocia
el maestro. Los reportes de Excel salen de la misma tabla de Oracle por otro
camino, y quedaban diciendo otra cosa: con el pivote de Polonia recodificado a
CEN-PVC-005, el maestro daba CEN-PVC-003 a Oro Blanco I y el Excel se lo daba a
Polonia, ademas de atribuirle a Polonia las etiquetas que estan pegadas en Oro
Blanco I. Un reporte que manda a una cuadrilla a la finca equivocada.

Es la misma razon por la que reglas_rotulado.py existe: no que sea mas corto,
sino que la app y la oficina no puedan contradecirse. Todo lo que lea
MAESTRO_MODULOS_RIEGO deberia pasar sus filas por aqui.

Esto es un puente, no un destino
--------------------------------
Cada entrada sobra en cuanto alguien captura el codigo en Oracle.
actualizar-maestro.py lo comprueba en cada corrida y avisa de cuales ya se
pueden borrar.
"""

# OBJECTID -> codigo asignado, para filas que Oracle tiene SIN codigo.
#
# Las 11 de la ronda del 2026-08-24 ya se capturaron en Oracle ese mismo dia y
# se quitaron de aqui: la tabla vacia es el estado sano. Se conserva el hueco,
# y no el archivo entero borrado, porque el caso vuelve cada vez que aparecen
# modulos nuevos sin codigo (tools/proponer_codigos_modulo.py los encuentra).
PENDIENTES_EN_ORACLE = {}

# OBJECTID -> (codigo nuevo, codigo que tenia al anotarse, motivo_huerfanas).
#
# El segundo valor no es decorativo: si Oracle ya no dice eso, alguien movio la
# fila despues de anotarse esto y la premisa dejo de ser cierta. Ahi no se pisa
# nada y se avisa, en vez de imponer una decision mas vieja que la de Oracle.
#
# El tercero es el permiso explicito para dejar etiquetas huerfanas. Por defecto
# va vacio y entonces la corrida se corta si el codigo viejo desaparece teniendo
# rotulado: es la proteccion que evita que un renombre deje rotulos pegados en
# el campo apuntando a un modulo que el maestro ya no conoce. Cuando la oficina
# decide asumirlo -porque el modulo se va a rotular de nuevo- se escribe aqui el
# motivo. Un texto y no un True: obliga a decir por que, y queda en el diff.
RECODIFICADOS = {
    # El pivote de Polonia (OBJECTID 4056) estuvo aqui del 2026-08-24 al
    # 2026-08-25: compartia CEN-PVC-003 con uno de Oro Blanco I y paso a
    # CEN-PVC-005. Oracle capturo el codigo nuevo, la corrida lo detecto y la
    # entrada se retiro. Las 2 etiquetas de CEN-PVC-003 estaban pegadas en Oro
    # Blanco I, que el 2026-08-25 renumero sus pivotes a la serie CES-PVC-001..006
    # -su prefijo correcto, porque Oro Blanco I es CENTRAL SUR-, asi que esas 2
    # hay que regrabarlas con el CES-PVC que le toque a ese pivote.

    # Morenas Fernandez (motor 0033-0531, OBJECTID 3602) estuvo aqui el
    # 2026-08-24: era CES-MNA-083 y pasaba a CES-ASP-004 porque no es mini
    # aspersion sino aspersion. Oracle capturo el codigo nuevo ese mismo dia, la
    # corrida lo detecto y la entrada se retiro. Sus 12 etiquetas viejas quedaron
    # huerfanas, como estaba previsto, y el modulo se regrabo con las 6 que le
    # tocan. Se deja escrito porque el rastro de por que un modulo cambio de
    # codigo no vive en ningun otro sitio.
}


def codigo_de(objectid, codigo_en_oracle):
    """
    El codigo que le toca a esa fila, o el de Oracle si no hay nada anotado.

    `codigo_en_oracle` se compara para no pisar una decision mas nueva: si la
    fila ya trae el codigo nuevo, o trae uno distinto del que se anoto, manda
    Oracle. Devolver siempre algo -y no None- deja que quien llama escriba
    `codigo_de(...)` sin ramas.
    """
    actual = (codigo_en_oracle or "").strip().upper()

    if not actual:
        return PENDIENTES_EN_ORACLE.get(objectid, codigo_en_oracle)

    entrada = RECODIFICADOS.get(objectid)
    if entrada and actual == entrada[1].strip().upper():
        return entrada[0]
    return codigo_en_oracle


def aplicar_a_filas(filas, col_objectid="OBJECTID", col_codigo="CODIGO_MODULO"):
    """
    Reescribe el codigo de las filas que lo tengan asignado. Devuelve los cambios.

    `filas` son diccionarios de Oracle. Se modifican en el sitio, que es lo que
    permite que el resto del camino -normalizacion, deduplicado, reglas- trate a
    estos modulos exactamente igual que a cualquier otro, sin una segunda via.
    """
    cambios = []
    for fila in filas:
        objectid = fila.get(col_objectid)
        if objectid is None:
            continue
        antes = fila.get(col_codigo)
        despues = codigo_de(int(objectid), antes)
        if despues != antes:
            fila[col_codigo] = despues
            cambios.append((int(objectid), antes, despues))
    return cambios
