"""
Convierte el maestro de riego en el modulos.json que viaja dentro del APK.

    python tools/generar-modulos.py Maestro_Modulos_Riego_20260731.xlsx

Solo usa la libreria estandar: un .xlsx es un ZIP con XML dentro.

Reglas de normalizacion (acordadas al revisar el maestro):

  Fincas
    - Numeros romanos partidos en letras sueltas se unen: "I I I" -> "III",
      "I V" -> "IV". Conviven las dos convenciones en el archivo original.
    - Romanos en minuscula se pasan a mayuscula: "Iv" -> "IV".
    - Abreviaturas expandidas: Sta./Sto. -> Santa/Santo, Sn. -> San,
      Fco. -> Francisco, Agrop. -> Agropecuaria.

  Responsables
    - Se quita el prefijo de lista pegado al nombre: "1: Byron ..." -> "Byron ...".
    - "Eddy Orellana" se unifica en "Eddy Leonardo Orellana Serrano": mismo
      nombre, mismo apellido y misma administracion.

  Modulos
    - Solo entran los que tienen ACTUALIZACION = ACTUALIZADO.
    - Los codigos repetidos se emiten una sola vez. En el maestro difieren en
      area, presion o hidrantes, pero coinciden en el numero de ramales, que es
      lo unico que determina cuantas etiquetas se graban.
"""
import json
import re
import sys
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import date

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'

ABREVIATURAS = {
    'STA': 'Santa',
    'STO': 'Santo',
    'SN': 'San',
    'FCO': 'Francisco',
    'AGROP': 'Agropecuaria',
}

FUSION_RESPONSABLES = {
    'EDDY ORELLANA': 'Eddy Leonardo Orellana Serrano',
}


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


# ---------------------------------------------------------- normalizacion

def sin_acentos(texto):
    descompuesto = unicodedata.normalize('NFKD', texto or '')
    return ''.join(c for c in descompuesto if not unicodedata.combining(c))


def clave(texto):
    return ' '.join(sin_acentos(texto).upper().split())


def normalizar_finca(nombre):
    palabras = nombre.split()

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
    limpio = re.sub(r'^\s*\d+\s*[:.\-]\s*', '', nombre)   # "3: Otto ..." -> "Otto ..."
    limpio = ' '.join(limpio.split())
    return FUSION_RESPONSABLES.get(clave(limpio), limpio)


def normalizar_simple(texto):
    """Colapsa espacios y unifica variantes de capitalizacion por su clave."""
    return ' '.join(texto.split())


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
