"""
Extrae de Oracle (IMSAPST) el listado de empleados por modulo de riego y
genera un Excel crudo, sin limpiar. Para el dato listo para usar, correr
despues limpiar_empleados_modulos.py sobre el archivo que este genera.

Requiere las dependencias: oracledb, openpyxl, keyring.
    pip install oracledb openpyxl keyring

Los datos del servidor salen de tools/conexion.local.json (ver el .ejemplo.json
al lado) y la contrasena del Administrador de Credenciales de Windows. Ninguno
de los dos esta en este archivo: el repositorio es publico.

El Excel que genera lleva nombres de colaboradores, asi que *.xlsx esta en
.gitignore. No lo subas al repositorio.
"""
import sys

from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

import _config

QUERY = """
SELECT
    D.COD_EMPLEADO AS CODIGO_COLABORADOR,
    D.NOM_EMPLEADO AS NOMBRE_COLABORADOR,
    M.ADMIN,
    M.EMPRESA,
    M.C_FINCA,
    M.FINCA,
    M.REGION,
    M.FABRICA,
    M.RESPONSABLE,
    M.TIPO_RIEGO,
    M.FUENTE_AGUA,
    M.ID_MOTOR,
    M.ID_MOTOR_2,
    M.COD_FUNCION,
    M.COD_MAQUINARIA,
    M.CODIGO_MODULO,
    M.NO_HIDRANTES,
    M.NO_RAMALES,
    M.PRESION_OPTIMA,
    M.RPM_OPTIMA,
    M.LAMINA_OPTIMA,
    M.HORAS_RIEGO_PRG,
    M.NO_POSICIONES,
    M.CAUDAL_REQUERIDO,
    M.AREA_MODULO,
    M.CREATED_USER,
    M.CREATED_DATE,
    M.LAST_EDITED_USER,
    M.LAST_EDITED_DATE
FROM
    SDEUSR.GRH_EMPLEADOS_MODULOS_RIEGOS D
LEFT OUTER JOIN
    (SELECT * FROM SDEUSR.MAESTRO_MODULOS_RIEGO) M
ON
    M.GLOBALID = D.ID_COD_EMP
"""


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else "Empleados_Modulos_Riego.xlsx"

    with _config.abrir_oracle() as con:
        cur = con.cursor()
        cur.execute(QUERY)
        cols = [d[0] for d in cur.description]
        rows = cur.fetchall()

    print(f"Filas obtenidas: {len(rows)}")

    wb = Workbook()
    ws = wb.active
    ws.title = "Detalle"
    ws.append(cols)
    for cell in ws[1]:
        cell.font = Font(bold=True)
    for row in rows:
        ws.append(list(row))
    for i, col in enumerate(cols, start=1):
        ws.column_dimensions[get_column_letter(i)].width = min(max(len(col), 12) + 2, 40)
    ws.freeze_panes = "A2"

    wb.save(out_path)
    print(f"Excel crudo generado: {out_path}")
    print("Ahora correr limpiar_empleados_modulos.py sobre este archivo.")


if __name__ == "__main__":
    main()
