"""
Pruebas de la unificacion de nombres.

    python tools/prueba_normalizar.py

No corre en la CI (no hay Python ahi), pero conviene ejecutarla antes de tocar
`normalizar_nombres.py`: un error aqui no rompe nada visible, solo fusiona a dos
personas en el maestro y en los reportes, y eso puede tardar semanas en verse.

No usa datos reales de nadie salvo el par `Jaime Cruz` / `Jaime de La Cruz`, que
es el caso que documenta por que hace falta `nunca_fusionar`.
"""
import sys

from normalizar_nombres import (
    agrupar_por_parecido, normalizar_finca, normalizar_responsable, parecidos,
    pares_dudosos,
)

ok = 0
mal = 0


def prueba(nombre, condicion, nota=''):
    global ok, mal
    if condicion:
        ok += 1
        print(f'  ok   {nombre}')
    else:
        mal += 1
        print(f'  FALLA {nombre}   {nota}')


print('\n== dos formas del mismo nombre ==')
prueba('se omite el segundo nombre',
       parecidos('Mario Lopez Lopez', 'Mario Rodolfo Lopez Lopez'))
prueba('una letra distinta en un apellido',
       parecidos('Ruano Velasquez Perez', 'Ruano Velazquez Perez'))
prueba('con y sin tilde',
       parecidos('Jose Martinez Ruiz', 'José Martínez Ruiz') is False,
       'iguales tras quitar tildes: no hay nada que fusionar')

print('\n== dos personas distintas ==')
prueba('distinto nombre de pila', not parecidos('Mario Lopez', 'Carlos Lopez'))
prueba('distinto ultimo apellido', not parecidos('Mario Lopez', 'Mario Perez'))
prueba('apellido intercalado que no encaja',
       not parecidos('Ana Lopez Diaz', 'Ana Perez Diaz'))

print('\n== el caso que obliga a tener la lista ==')
prueba('el par peligroso SI se detecta como parecido',
       parecidos('Jaime Cruz', 'Jaime de La Cruz'),
       'si dejara de detectarse, nunca_fusionar sobraria y el riesgo seguiria')

nombres = ['Mario Lopez Lopez', 'Mario Rodolfo Lopez Lopez',
           'Jaime Cruz', 'Jaime de La Cruz', 'Otto Estrada']

mapa_sin, _ = agrupar_por_parecido(nombres, {}, [])
prueba('sin la lista los dos Jaime se fusionarian',
       mapa_sin['Jaime Cruz'] == mapa_sin['Jaime de La Cruz'],
       'esta prueba documenta el riesgo real, no un deseo')

print('\n== agrupar ==')
veto = [('Jaime Cruz', 'Jaime de La Cruz')]
mapa, informe = agrupar_por_parecido(nombres, {}, veto)
prueba('gana la grafia mas larga',
       mapa['Mario Lopez Lopez'] == 'Mario Rodolfo Lopez Lopez', mapa)
prueba('la lista separa a los dos Jaime',
       mapa['Jaime Cruz'] == 'Jaime Cruz' and mapa['Jaime de La Cruz'] == 'Jaime de La Cruz', mapa)
prueba('quien no se parece a nadie queda igual', mapa['Otto Estrada'] == 'Otto Estrada')
prueba('el informe lista solo lo fusionado',
       len(informe) == 1 and informe[0]['motivo'] == 'parecido', informe)

print('\n== una decision a mano manda sobre el parecido ==')
mapa3, inf3 = agrupar_por_parecido(
    ['Eddy Orellana', 'Eddy Leonardo Orellana Serrano'],
    {'Eddy Orellana': 'Eddy Leonardo Orellana Serrano'}, [])
prueba('gana la grafia escrita a mano',
       set(mapa3.values()) == {'Eddy Leonardo Orellana Serrano'}, mapa3)
prueba('y queda marcada como tal',
       inf3 and inf3[0]['motivo'] == 'decidido a mano', inf3)

print('\n== determinismo ==')
a, _ = agrupar_por_parecido(nombres, {}, veto)
b, _ = agrupar_por_parecido(list(reversed(nombres)), {}, veto)
prueba('el orden de entrada no cambia el resultado', a == b,
       'dos corridas seguidas deben dar el mismo modulos.json')

print('\n== zona gris ==')
dudosos = pares_dudosos(['Ana Lopez Diaz', 'Ana Perez Diaz', 'Otto Estrada'], [])
prueba('un par que comparte nombre y ultimo apellido sale a revisar',
       any({x[0], x[1]} == {'Ana Lopez Diaz', 'Ana Perez Diaz'} for x in dudosos), dudosos)
prueba('lo ya decidido no vuelve a preguntarse',
       pares_dudosos(['Ana Lopez Diaz', 'Ana Perez Diaz'],
                     [('Ana Lopez Diaz', 'Ana Perez Diaz')]) == [])

print('\n== fincas (reglas deterministas, sin parecido) ==')
prueba('romanos partidos se unen', normalizar_finca('Sta. Isabel I I I') == 'Santa Isabel III')
prueba('romanos en minuscula', normalizar_finca('Providencia Iv') == 'Providencia IV')
prueba('abreviaturas', normalizar_finca('Sn. Fco.') == 'San Francisco')
prueba('Providencia I y II NO se tocan',
       normalizar_finca('Providencia I') != normalizar_finca('Providencia II'),
       'por esto el parecido no se aplica a fincas')

print('\n== responsables: prefijo de lista ==')
prueba('se quita el numero pegado', normalizar_responsable('2: Enzo Barrientos') == 'Enzo Barrientos')

print(f'\n{ok} pruebas pasadas, {mal} fallidas\n')
sys.exit(1 if mal else 0)
