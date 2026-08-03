"""
Limpia el Excel crudo de extraer_empleados_modulos.py:

- Colapsa espacios sobrantes en NOMBRE_COLABORADOR y RESPONSABLE.
- Quita el prefijo de lista pegado al responsable ("2: Enzo ..." -> "Enzo ...").
- Un mismo CODIGO_COLABORADOR con el nombre escrito distinto entre filas
  (ej. una vez completo y otra solo nombre + primer apellido, o con/sin
  tilde) se unifica a una sola version. Los casos ya revisados estan en
  CORRECCIONES_NOMBRE; si aparece un caso nuevo que este script no conoce,
  se avisa en vez de adivinar.
- Los empleados sin modulo asignado (join sin match en MAESTRO_MODULOS_RIEGO)
  quedan agrupados aparte como "(Sin modulo asignado)" en los resumenes, en
  vez de una fila en blanco.
- Registros con el nombre incompleto en el origen (ORACLE) se marcan en rojo
  con una nota, pero se cuentan igual: revisado con Ingenio Magdalena
  2026-08-03, sí cuentan para el numero de telefonos porque ya tienen
  modulo asignado.

Genera un Excel con: Detalle (limpio), Resumen por modulo, Resumen por
responsable, En varios modulos, y Cambios aplicados (auditoria de que se
toco y por que).

OJO al leer los resumenes: la suma de "Resumen por modulo" es mayor que la
de "Resumen por responsable" porque hay colaboradores que atienden dos
modulos y ahi cuentan una vez por cada uno. La primera suma ASIGNACIONES,
la segunda PERSONAS. Para pedir telefonos vale la segunda. Ambas hojas
llevan su total al pie y la hoja "En varios modulos" lista quienes son.
"""
import re
import sys
from collections import defaultdict

import openpyxl
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter

import _config

SIN_MODULO = "(Sin modulo asignado)"

# Las decisiones de limpieza viven en tools/normalizaciones.local.json, no aqui:
# son nombres de personas y el repositorio es publico.
#
# - correcciones_nombre: mismo CODIGO_COLABORADOR que llego escrito de forma
#   distinta entre filas. Revisados uno a uno contra el resto de la fila (finca,
#   responsable) para confirmar que es la misma persona antes de unificar.
# - incompletos: nombre que el origen no tiene completo. Cuenta igual para el
#   numero de telefonos (ya tiene modulo), pero se marca para corregirlo.
_NORM = _config.normalizaciones()
CORRECCIONES_NOMBRE = _NORM["correcciones_nombre"]
INCOMPLETOS = _NORM["incompletos"]

ROJO = PatternFill(start_color="FFF4CCCC", end_color="FFF4CCCC", fill_type="solid")


def limpiar_espacios(texto):
    if texto is None:
        return texto
    return re.sub(r"\s+", " ", str(texto).strip())


def limpiar_responsable(texto):
    texto = limpiar_espacios(texto)
    if texto is None:
        return texto
    return re.sub(r"^\d+\s*[:.\-]\s*", "", texto)


def main():
    in_path = sys.argv[1] if len(sys.argv) > 1 else "Empleados_Modulos_Riego.xlsx"
    out_path = sys.argv[2] if len(sys.argv) > 2 else in_path.replace(".xlsx", "_LIMPIO.xlsx")

    wb_in = openpyxl.load_workbook(in_path)
    ws_in = wb_in["Detalle"]
    filas = list(ws_in.iter_rows(values_only=True))
    cols = list(filas[0])
    idx = {c: i for i, c in enumerate(cols)}
    datos = [list(f) for f in filas[1:]]

    i_codigo = idx["CODIGO_COLABORADOR"]
    i_nombre = idx["NOMBRE_COLABORADOR"]
    i_resp = idx["RESPONSABLE"]
    i_finca = idx["FINCA"]
    i_modulo = idx["CODIGO_MODULO"]

    # Aviso de codigos con nombres distintos que este script no conoce
    # todavia, para no corregir a ciegas si aparecen en una extraccion nueva.
    por_codigo = defaultdict(set)
    for fila in datos:
        nombre = limpiar_espacios(fila[i_nombre])
        if nombre:
            por_codigo[fila[i_codigo]].add(nombre)
    nuevos_conflictos = {
        c: v for c, v in por_codigo.items() if len(v) > 1 and c not in CORRECCIONES_NOMBRE
    }
    if nuevos_conflictos:
        print("AVISO: codigos con nombre inconsistente que no estan en CORRECCIONES_NOMBRE:")
        for c, v in nuevos_conflictos.items():
            print(f"  {c}: {sorted(v)}")
        print("Revisalos y agregalos al diccionario antes de confiar en el resultado.\n")

    cambios = []  # (codigo, campo, original, nuevo)
    incompletas_filas = []

    for fila in datos:
        codigo = fila[i_codigo]

        original_nombre = fila[i_nombre]
        nuevo_nombre = limpiar_espacios(original_nombre)
        if codigo in CORRECCIONES_NOMBRE:
            nuevo_nombre = CORRECCIONES_NOMBRE[codigo]
        if nuevo_nombre != (original_nombre or None) and (original_nombre or nuevo_nombre):
            if (original_nombre or "") != (nuevo_nombre or ""):
                cambios.append((codigo, "NOMBRE_COLABORADOR", original_nombre, nuevo_nombre))
        fila[i_nombre] = nuevo_nombre

        original_resp = fila[i_resp]
        nuevo_resp = limpiar_responsable(original_resp)
        if (original_resp or "") != (nuevo_resp or ""):
            cambios.append((codigo, "RESPONSABLE", original_resp, nuevo_resp))
        fila[i_resp] = nuevo_resp

        for campo in (i_finca, i_modulo):
            original = fila[campo]
            nuevo = limpiar_espacios(original)
            if (original or "") != (nuevo or ""):
                cambios.append((codigo, cols[campo], original, nuevo))
            fila[campo] = nuevo

        if not fila[i_modulo]:
            fila[i_finca] = fila[i_finca] or SIN_MODULO
            fila[i_modulo] = fila[i_modulo] or SIN_MODULO
            fila[i_resp] = fila[i_resp] or SIN_MODULO

        if codigo in INCOMPLETOS:
            incompletas_filas.append(fila)

    # ---------------------------------------------------------------- Detalle
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Detalle"
    ws.append(cols + ["OBSERVACION"])
    for cell in ws[1]:
        cell.font = Font(bold=True)
    for fila in datos:
        nota = INCOMPLETOS.get(fila[i_codigo], "")
        ws.append(fila + [nota])
        if nota:
            for cell in ws[ws.max_row]:
                cell.fill = ROJO
    for i, col in enumerate(cols + ["OBSERVACION"], start=1):
        ws.column_dimensions[get_column_letter(i)].width = min(max(len(col), 12) + 2, 40)
    ws.freeze_panes = "A2"

    # Colaboradores que atienden mas de un modulo. Son la razon por la que la
    # suma de "Resumen por modulo" (asignaciones) es mayor que la de "Resumen
    # por responsable" (personas): en la primera cuentan una vez por modulo.
    # Para pedir telefonos manda el numero de PERSONAS, no el de asignaciones.
    modulos_por_codigo = defaultdict(set)
    datos_por_codigo = {}
    for fila in datos:
        modulos_por_codigo[fila[i_codigo]].add(fila[i_modulo])
        datos_por_codigo[fila[i_codigo]] = fila
    compartidos = {c: m for c, m in modulos_por_codigo.items() if len(m) > 1}

    total_personas = len({fila[i_codigo] for fila in datos})

    # ------------------------------------------------------------ Resumen modulo
    conteo_modulo = defaultdict(set)
    for fila in datos:
        clave = (fila[i_resp], fila[i_finca], fila[i_modulo])
        conteo_modulo[clave].add(fila[i_codigo])

    ws2 = wb.create_sheet("Resumen por modulo")
    ws2.append(["RESPONSABLE", "FINCA", "CODIGO_MODULO", "NUMERO_COLABORADORES",
                "DE_ESOS_TAMBIEN_EN_OTRO_MODULO"])
    for cell in ws2[1]:
        cell.font = Font(bold=True)
    for (responsable, finca, modulo), colaboradores in sorted(
        conteo_modulo.items(), key=lambda kv: (str(kv[0][0]), str(kv[0][1]), str(kv[0][2]))
    ):
        repetidos = len([c for c in colaboradores if c in compartidos])
        ws2.append([responsable, finca, modulo, len(colaboradores), repetidos])
    fila_total = ws2.max_row + 2
    ws2.cell(fila_total, 1, "TOTAL asignaciones (suma de la columna)").font = Font(bold=True)
    ws2.cell(fila_total, 4, sum(len(v) for v in conteo_modulo.values())).font = Font(bold=True)
    ws2.cell(fila_total + 1, 1, "TOTAL personas distintas").font = Font(bold=True)
    ws2.cell(fila_total + 1, 4, total_personas).font = Font(bold=True)
    ws2.cell(fila_total + 2, 1,
             f"La diferencia son {len(compartidos)} colaboradores que atienden 2 modulos: "
             "aqui cuentan una vez por modulo, pero son una sola persona (un solo telefono).")
    for i, w in enumerate([38, 30, 22, 22, 30], start=1):
        ws2.column_dimensions[get_column_letter(i)].width = w
    ws2.freeze_panes = "A2"

    # --------------------------------------------------------- Resumen responsable
    conteo_resp = defaultdict(set)
    for fila in datos:
        conteo_resp[fila[i_resp]].add(fila[i_codigo])

    ws3 = wb.create_sheet("Resumen por responsable")
    ws3.append(["RESPONSABLE", "NUMERO_COLABORADORES"])
    for cell in ws3[1]:
        cell.font = Font(bold=True)
    for responsable, colaboradores in sorted(conteo_resp.items(), key=lambda kv: str(kv[0])):
        ws3.append([responsable, len(colaboradores)])
    fila_total = ws3.max_row + 2
    ws3.cell(fila_total, 1, "TOTAL personas distintas").font = Font(bold=True)
    ws3.cell(fila_total, 2, total_personas).font = Font(bold=True)
    ws3.cell(fila_total + 1, 1,
             "Este es el numero de telefonos a asignar: nadie aparece bajo dos responsables.")
    ws3.column_dimensions["A"].width = 38
    ws3.column_dimensions["B"].width = 22
    ws3.freeze_panes = "A2"

    # ------------------------------------------------- Colaboradores compartidos
    ws5 = wb.create_sheet("En varios modulos")
    ws5.append(["CODIGO_COLABORADOR", "NOMBRE_COLABORADOR", "RESPONSABLE",
                "MODULOS_QUE_ATIENDE", "CUANTOS_MODULOS"])
    for cell in ws5[1]:
        cell.font = Font(bold=True)
    for codigo, mods in sorted(compartidos.items()):
        fila = datos_por_codigo[codigo]
        ws5.append([codigo, fila[i_nombre], fila[i_resp],
                    ", ".join(sorted(str(m) for m in mods)), len(mods)])
    for i, w in enumerate([20, 34, 34, 30, 18], start=1):
        ws5.column_dimensions[get_column_letter(i)].width = w
    ws5.freeze_panes = "A2"

    # ------------------------------------------------------------------- Auditoria
    ws4 = wb.create_sheet("Cambios aplicados")
    ws4.append(["CODIGO_COLABORADOR", "CAMPO", "VALOR_ORIGINAL", "VALOR_NUEVO"])
    for cell in ws4[1]:
        cell.font = Font(bold=True)
    for codigo, campo, original, nuevo in cambios:
        ws4.append([codigo, campo, original, nuevo])
    for i, w in enumerate([20, 20, 35, 35], start=1):
        ws4.column_dimensions[get_column_letter(i)].width = w
    ws4.freeze_panes = "A2"

    wb.save(out_path)

    print(f"Filas procesadas (asignaciones): {len(datos)}")
    print(f"Personas distintas (telefonos): {total_personas}")
    print(f"Colaboradores en 2+ modulos: {len(compartidos)}")
    print(f"Cambios de texto aplicados: {len(cambios)}")
    print(f"Registros marcados incompletos: {len(incompletas_filas)}")
    print(f"Excel limpio generado: {out_path}")


if __name__ == "__main__":
    main()
