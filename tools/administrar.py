"""
Operaciones de oficina sobre el registro compartido de rotulado.

    python tools/administrar.py estado
    python tools/administrar.py csv                       -> detalle a un .csv
    python tools/administrar.py csv --vista resumen
    python tools/administrar.py duplicados
    python tools/administrar.py reiniciar OOC-MNA-001
    python tools/administrar.py reiniciar OOC-MNA-001 --pasada 2

La llave de administrador NO viaja en el APK y no se versiona. Se lee de la
variable de entorno NFC_ADMIN_KEY o del llavero de Windows:

    python -c "import keyring; keyring.set_password('appnfc_backend', 'admin', 'la-llave')"

Por que reiniciar esta aqui y no en la app
------------------------------------------
Un reinicio manda a rotular de nuevo un modulo entero, con sus etiquetas y su
jornada de campo. La llave que viaja dentro del APK se saca con un `unzip`, asi
que si la app pudiera reiniciar, cualquiera con el APK podria borrar el trabajo
de todos. Por eso son dos llaves y por eso esto se corre desde una PC.

El servidor no borra ninguna fila: anade una barrera con SU marca de tiempo. Si
el reinicio fue un error, el historico completo sigue en la tabla.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from collections import Counter
from datetime import date
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


def base_url():
    cfg = RAIZ / 'config.js'
    if cfg.exists():
        for linea in cfg.read_text(encoding='utf-8').splitlines():
            if 'apiBase' in linea and "'" in linea:
                return linea.split("'")[1].rstrip('/')
    print('No se encontro apiBase en config.js', file=sys.stderr)
    sys.exit(1)


def llave(nombre_var, servicio, usuario):
    valor = os.environ.get(nombre_var)
    if valor:
        return valor
    try:
        import keyring
        valor = keyring.get_password(servicio, usuario)
    except ImportError:
        valor = None
    if not valor:
        print(f'Falta la llave. Pon {nombre_var} en el entorno, o guardala una vez con:',
              file=sys.stderr)
        print(f'  python -c "import keyring; keyring.set_password('
              f"'{servicio}', '{usuario}', 'la-llave')\"", file=sys.stderr)
        sys.exit(1)
    return valor


def pedir(ruta, cabeceras, metodo='GET', cuerpo=None, crudo=False):
    datos = json.dumps(cuerpo).encode('utf-8') if cuerpo is not None else None
    if datos:
        cabeceras = {**cabeceras, 'content-type': 'application/json'}
    pet = urllib.request.Request(base_url() + ruta, data=datos, headers=cabeceras, method=metodo)
    try:
        with urllib.request.urlopen(pet, timeout=60) as r:
            bruto = r.read()
            return bruto if crudo else json.loads(bruto.decode('utf-8'))
    except urllib.error.HTTPError as e:
        detalle = e.read().decode('utf-8', 'replace')[:400]
        print(f'HTTP {e.code}: {detalle}', file=sys.stderr)
        sys.exit(1)
    except (urllib.error.URLError, TimeoutError) as e:
        print(f'No se pudo hablar con el servidor: {e}', file=sys.stderr)
        sys.exit(1)


def cab_app():
    return {'x-app-key': llave('NFC_APP_KEY', 'appnfc_backend', 'app')}


def cab_admin():
    return {'x-admin-key': llave('NFC_ADMIN_KEY', 'appnfc_backend', 'admin')}


# ------------------------------------------------------------------ comandos

def todos_los_eventos():
    eventos, desde = [], 0
    for _ in range(50):
        r = pedir(f'/api/eventos?desde={desde}&limite=1000', cab_app())
        eventos.extend(r.get('eventos', []))
        if not r.get('hayMas'):
            break
        desde = r.get('siguienteCursor', desde)
    return eventos


def cmd_estado(args):
    salud = pedir('/api/salud', cab_app())
    eventos = todos_los_eventos()

    grabadas = [e for e in eventos if e.get('tipo') != 'reset']
    resets = [e for e in eventos if e.get('tipo') == 'reset']
    modulos = Counter(e['modulo'] for e in grabadas)
    telefonos = Counter(e['dispositivo'] for e in grabadas)

    print(f"servidor        : {'ok' if salud.get('ok') else 'CAIDO'}"
          f"  ({salud.get('serverTime')})")
    print(f'eventos en total: {len(eventos)}   ({len(grabadas)} grabadas, {len(resets)} reinicios)')
    print(f'modulos tocados : {len(modulos)}')
    print(f'telefonos       : {len(telefonos)}')
    for d, n in telefonos.most_common():
        print(f'    {d}  {n} etiquetas')
    if resets:
        print('reinicios:')
        for e in sorted(resets, key=lambda x: x['fecha']):
            print(f"    {e['fecha']}  {e['modulo']} pasada {e['pasada']}"
                  f"  {e.get('responsable') or ''}")


def cmd_duplicados(args):
    """Etiquetas que dos telefonos grabaron por separado: hay dos rotulos iguales."""
    eventos = todos_los_eventos()
    vistos = {}
    repetidas = {}
    for e in eventos:
        if e.get('tipo') == 'reset':
            continue
        k = (e['modulo'], e['pasada'], e['numero'])
        if k in vistos and vistos[k] != e['dispositivo']:
            repetidas.setdefault(k, set()).update({vistos[k], e['dispositivo']})
        vistos[k] = e['dispositivo']

    if not repetidas:
        print('Ninguna etiqueta repetida.')
        return
    print(f'{len(repetidas)} etiqueta(s) grabadas por dos telefonos distintos.')
    print('Hay dos rotulos fisicos iguales pegados en el campo; hay que retirar uno.\n')
    for (mod, pasada, numero), quienes in sorted(repetidas.items()):
        print(f'  {mod}  pasada {pasada}  n {numero:>3}   {" y ".join(sorted(quienes))}')


def cmd_csv(args):
    ruta = f'/api/csv?vista={args.vista}'
    if args.modulo:
        ruta += f'&modulo={args.modulo}'
    contenido = pedir(ruta, cab_admin(), crudo=True)

    destino = Path(args.salida or
                   f'rotulado_{args.vista}_{date.today().isoformat()}.csv')
    destino.write_bytes(contenido)
    filas = contenido.decode('utf-8-sig').count('\r\n') - 1
    print(f'{destino}: {max(filas, 0)} filas')


def cmd_reiniciar(args):
    modulo = args.modulo.upper()
    alcance = f'la pasada {args.pasada}' if args.pasada else 'las DOS pasadas'

    print(f'Se va a reiniciar {alcance} de {modulo} para TODOS los telefonos.')
    print('No se borra ninguna fila, pero los operadores veran el modulo como no rotulado')
    print('y volveran a grabarlo entero.')
    if not args.si:
        if input(f'\nEscribe el codigo del modulo para confirmar: ').strip().upper() != modulo:
            print('No coincide. No se hizo nada.')
            return 1

    r = pedir('/api/reset', cab_admin(), metodo='POST', cuerpo={
        'modulo': modulo,
        'pasada': args.pasada,
        'confirmacion': modulo,
        'motivo': args.motivo or '',
        'quien': args.quien or os.environ.get('USERNAME', 'oficina'),
    })
    print(f"\nHecho: {r['reiniciadas']} etiquetas dejan de contar en {modulo}.")
    print(f"  pasadas  : {r['pasadas']}")
    print(f"  fecha    : {r['fecha']}  (la puso el servidor)")
    print(f"  eventos  : {', '.join(r['eventos']) or '(ya existian)'}")
    print(f"  {r['nota']}")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)

    sub.add_parser('estado', help='resumen de lo que hay en el registro')
    sub.add_parser('duplicados', help='etiquetas grabadas por dos telefonos')

    p = sub.add_parser('csv', help='exportar el registro compartido')
    p.add_argument('--vista', choices=['detalle', 'resumen'], default='detalle')
    p.add_argument('--modulo', default='')
    p.add_argument('--salida', default='')

    p = sub.add_parser('reiniciar', help='borrar el avance de un modulo para todos')
    p.add_argument('modulo')
    p.add_argument('--pasada', type=int, choices=[1, 2], default=None,
                   help='solo esa pasada; por defecto las dos')
    p.add_argument('--motivo', default='')
    p.add_argument('--quien', default='')
    p.add_argument('--si', action='store_true', help='no pedir confirmacion')

    args = ap.parse_args()
    return {
        'estado': cmd_estado,
        'duplicados': cmd_duplicados,
        'csv': cmd_csv,
        'reiniciar': cmd_reiniciar,
    }[args.cmd](args) or 0


if __name__ == '__main__':
    sys.exit(main())
