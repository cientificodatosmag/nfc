"""
Carga la configuracion local de los scripts de datos.

El repositorio es publico, asi que ni la conexion a Oracle ni las correcciones
de nombres (que son datos de personas) viven en el codigo. Se leen de archivos
*.local.json que estan en .gitignore. Junto a cada uno hay un *.ejemplo.json
versionado que documenta la estructura.

La contrasena no esta ni siquiera en el archivo local: vive en el Administrador
de Credenciales de Windows y se lee con keyring.
"""
import json
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent


def _cargar(nombre):
    local = AQUI / f"{nombre}.local.json"
    ejemplo = AQUI / f"{nombre}.ejemplo.json"

    if not local.exists():
        print(f"Falta {local}", file=sys.stderr)
        if ejemplo.exists():
            print(f"Copia {ejemplo.name} como {local.name} y rellena los valores reales.",
                  file=sys.stderr)
        sys.exit(1)

    try:
        return json.loads(local.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"{local.name} no es JSON valido: {e}", file=sys.stderr)
        sys.exit(1)


def conexion():
    """Datos del servidor Oracle. La contrasena sale del llavero, no de aqui."""
    cfg = _cargar("conexion")
    faltan = [c for c in ("host", "puerto", "servicio", "usuario", "keyring_servicio")
              if c not in cfg]
    if faltan:
        print(f"conexion.local.json sin las claves: {', '.join(faltan)}", file=sys.stderr)
        sys.exit(1)
    return cfg


def normalizaciones():
    """
    Decisiones de limpieza tomadas con Ingenio Magdalena.

    - correcciones_nombre: codigo de colaborador -> grafia unica acordada, para
      cuando el mismo codigo llega escrito de dos formas distintas.
    - incompletos: codigo -> nota, para registros que el origen no tiene
      completos y hay que corregir en Oracle.
    - fusiones_responsable: variante -> grafia buena. Los responsables NO traen
      codigo, asi que aqui el parecido automatico puede equivocarse y esta lista
      es la forma de mandar sobre el.
    - nunca_fusionar: pares que se parecen y son personas distintas. Sin esto,
      cualquier medida de parecido junta a "Jaime Cruz" con "Jaime de La Cruz".
    """
    cfg = _cargar("normalizaciones")
    return {
        # Las claves de un JSON son texto; los codigos se comparan como enteros.
        "correcciones_nombre": {int(k): v for k, v in cfg.get("correcciones_nombre", {}).items()},
        "incompletos": {int(k): v for k, v in cfg.get("incompletos", {}).items()},
        "fusiones_responsable": cfg.get("fusiones_responsable", {}),
        "nunca_fusionar": [tuple(p) for p in cfg.get("nunca_fusionar", []) if len(p) == 2],
    }


def abrir_oracle():
    """Conexion lista para usar, con la contrasena del llavero de Windows."""
    import keyring
    import oracledb

    cfg = conexion()
    pwd = keyring.get_password(cfg["keyring_servicio"], cfg["usuario"])
    if not pwd:
        print(f"No hay contrasena guardada para {cfg['usuario']} en el llavero de Windows.",
              file=sys.stderr)
        print("Guardala una vez con:", file=sys.stderr)
        print(f"  python -c \"import keyring; keyring.set_password("
              f"'{cfg['keyring_servicio']}', '{cfg['usuario']}', 'la-contrasena')\"",
              file=sys.stderr)
        sys.exit(1)

    dsn = oracledb.makedsn(cfg["host"], cfg["puerto"], service_name=cfg["servicio"])
    return oracledb.connect(user=cfg["usuario"], password=pwd, dsn=dsn)
