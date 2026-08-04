"""
Convierte el maestro de riego en el modulos.json que viaja dentro del APK.

    python tools/generar-modulos.py Maestro_Modulos_Riego_20260731.xlsx

Solo usa la libreria estandar: un .xlsx es un ZIP con XML dentro.

EN RETIRADA: el maestro sale ahora de Oracle con tools/actualizar-maestro.py.
Este script se conserva porque la columna ACTUALIZACION solo existe en el .xlsx
y sigue siendo la unica forma de reproducir el modulos.json de julio.

Las reglas de normalizacion viven en normalizar_nombres.py, compartidas con el
generador de Oracle: que los dos apliquen lo mismo es lo que permite comparar
sus salidas.

  Modulos
    - Solo entran los que tienen ACTUALIZACION = ACTUALIZADO.
    - Los codigos repetidos se emiten una sola vez. En el maestro difieren en
      area, presion o hidrantes, pero coinciden en el numero de ramales, que es
      lo unico que determina cuantas etiquetas se graban.
"""
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import date

from normalizar_nombres import (
    clave, normalizar_finca, normalizar_responsable, normalizar_simple,
)

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


# ---------------------------------------------------------------- lectura xlsx

def _col(ref):
    n = 0
    for ch in re.match(r'[A-Z]+', ref).group(0):
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def leer_xlsx(path):
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        root = ET.fromstring(z.read('xl/sharedStrings.xml'))
        shared = [''.join(t.text or '' for t in si.iter(f'{NS}t'))
                  for si in root.findall(f'{NS}si')]

    hoja = sorted(n for n in z.namelist() if n.startswith('xl/worksheets/sheet'))[0]
    root = ET.fromstring(z.read(hoja))

    filas = []
    for row in root.iter(f'{NS}row'):
        celdas = {}
        for c in row.findall(f'{NS}c'):
            ref = c.get('r')
            if not ref:
                continue
            v = c.find(f'{NS}v')
            if c.get('t') == 's' and v is not None:
                valor = shared[int(v.text)]
            elif v is not None:
                valor = v.text
            else:
                valor = ''
            celdas[_col(ref)] = (valor or '').strip()
        if celdas:
            filas.append([celdas.get(i, '') for i in range(max(celdas) + 1)])
    return filas


# ---------------------------------------------------------------- construccion

def construir(filas):
    cabecera = filas[0]
    col = {nombre: i for i, nombre in enumerate(cabecera)}
    datos = [f + [''] * (len(cabecera) - len(f)) for f in filas[1:]]

    canonico_riego = {}
    canonico_agua = {}
    for fila in datos:
        for columna, destino in (('Tipo de riego', canonico_riego), ('Fuente de agua', canonico_agua)):
            valor = normalizar_simple(fila[col[columna]])
            if valor:
                destino.setdefault(clave(valor), valor)

    por_codigo = defaultdict(list)
    for fila in datos:
        if clave(fila[col['ACTUALIZACION']]) != 'ACTUALIZADO':
            continue
        codigo = fila[col['Codigo modulo']].strip()
        ramales = fila[col['Numero de ramales']].strip()
        if not codigo or not ramales:
            continue
        por_codigo[codigo].append(fila)

    modulos = []
    avisos = []
    for codigo in sorted(por_codigo):
        repetidas = por_codigo[codigo]
        primera = repetidas[0]

        ramales_distintos = {r[col['Numero de ramales']].strip() for r in repetidas}
        if len(repetidas) > 1:
            difieren = [cabecera[i] for i in range(len(cabecera))
                        if cabecera[i] != 'OBJECTID' and len({r[i] for r in repetidas}) > 1]
            avisos.append({
                'codigo': codigo,
                'registros': len(repetidas),
                'columnasDistintas': difieren,
                'mismoNumeroDeRamales': len(ramales_distintos) == 1,
            })
            if len(ramales_distintos) > 1:
                print(f'  AVISO: {codigo} repetido CON ramales distintos {ramales_distintos}; '
                      f'se usa el primero ({primera[col["Numero de ramales"]]})')

        modulos.append({
            'codigo': codigo,
            'region': normalizar_simple(primera[col['Región']]),
            'responsable': normalizar_responsable(primera[col['Responsable']]),
            'finca': normalizar_finca(normalizar_simple(primera[col['Finca']])),
            'codigoFinca': primera[col['Codigo finca']].strip(),
            'ramales': int(float(primera[col['Numero de ramales']])),
            'tipoRiego': canonico_riego.get(clave(primera[col['Tipo de riego']]), ''),
            'fuenteAgua': canonico_agua.get(clave(primera[col['Fuente de agua']]), ''),
            'duplicado': len(repetidas) > 1,
        })

    return modulos, avisos


def main():
    origen = sys.argv[1] if len(sys.argv) > 1 else 'Maestro_Modulos_Riego_20260731.xlsx'
    destino = sys.argv[2] if len(sys.argv) > 2 else 'modulos.json'

    modulos, avisos = construir(leer_xlsx(origen))

    salida = {
        'generado': date.today().isoformat(),
        'fuente': origen.replace('\\', '/').split('/')[-1],
        'avisos': avisos,
        'modulos': modulos,
    }
    with open(destino, 'w', encoding='utf-8') as f:
        json.dump(salida, f, ensure_ascii=False, indent=2)
        f.write('\n')

    print(f'{destino}: {len(modulos)} modulos actualizados')
    print(f'  regiones:     {len({m["region"] for m in modulos})}')
    print(f'  responsables: {len({m["responsable"] for m in modulos})}')
    print(f'  fincas:       {len({m["finca"] for m in modulos})}')
    print(f'  etiquetas:    {sum(m["ramales"] + 4 for m in modulos)}')
    for aviso in avisos:
        print(f'  duplicado {aviso["codigo"]}: {aviso["registros"]} registros, '
              f'difieren en {aviso["columnasDistintas"]}')


if __name__ == '__main__':
    main()
