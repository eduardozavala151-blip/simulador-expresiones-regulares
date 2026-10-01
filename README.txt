REGEXLAB — SIMULADOR FORMAL DE EXPRESIONES REGULARES

Alumno: Jesús Eduardo Hernández Zavala
Matrícula: 24500264
Materia: Lenguajes y Autómatas I

CASO DE TU DOCENTE
------------------
Expresión regular utilizada por defecto:

a(b+c)*

En la notación usada por JFLAP, + representa unión o alternativa.
Por lo tanto, b+c significa "b o c".
La expresión completa significa:

- La cadena debe comenzar obligatoriamente con a.
- Después puede aparecer cualquier cantidad de b y c.
- Puede aparecer cero veces, una vez o muchas veces la parte (b+c).

Formalmente:
L = { a·w | w ∈ {b,c}* }

Cadenas aceptadas de ejemplo:
a, ab, ac, abb, abc, acb, acc, abcb, acbc

Cadenas rechazadas de ejemplo:
!, b, c, ba, aa, baa, abcx, a1, ca

QUE SIMULA EL PROGRAMA
----------------------
El objetivo del simulador es representar el recorrido de una cadena sobre el
autómata que reconoce la expresión regular, de forma equivalente al proceso de
simulación que se observa en JFLAP.

Flujo formal:
1. Se analiza la expresión regular.
2. Se construye un AFN/NFA mediante la construcción de Thompson.
3. El NFA se convierte a un AFD/DFA mediante construcción por subconjuntos.
4. Cada cadena se ejecuta sobre el autómata.
5. En la vista NFA se muestra la configuración de estados activos en cada paso,
   incluyendo el cierre-ε.
6. En la vista DFA se muestra el estado alcanzado después de cada símbolo.
7. El sistema indica si la cadena es ACEPTADA o RECHAZADA.

SIMULACIÓN PASO A PASO
----------------------
Selecciona una cadena en "Recorrido" y utiliza:
- Paso anterior: retrocede una posición.
- Siguiente: avanza un símbolo.
- Animar recorrido: reproduce automáticamente los pasos.

La vista "NFA · JFLAP" es la referencia principal para comparar visualmente
el recorrido con el autómata realizado en JFLAP.

SINTAXIS PRINCIPAL
------------------
literal, ., +, |, *, ?, grupos (), clases [abc], rangos [a-z], negación [^abc],
escapes \d, \w, \s y repetición {m}, {m,}, {m,n}.

Importante: en este simulador, cuando se trabaja en notación JFLAP, + se
interpreta como unión/alternativa. El símbolo | también se admite como
alternativa para facilitar otras expresiones.

OTRAS FUNCIONES
---------------
- Varias cadenas de prueba al mismo tiempo.
- Cadenas cargadas por defecto para el caso a(b+c)*.
- Botón "Generar cadenas" para crear automáticamente casos aceptados y
  rechazados del ejemplo del docente.
- Botón "Caso docente" para restaurar la expresión y las cadenas iniciales.
- Limpiar cadenas.
- Reiniciar todo.
- Exportar resultados a CSV.
- Visualización NFA/DFA.

NOTAS
-----
- Las banderas m y s se conservan en la interfaz por compatibilidad, pero no
  modifican la construcción formal porque el autómata trabaja sobre símbolos.
- La bandera i permite comparar sin distinguir mayúsculas y minúsculas.
- El programa funciona localmente sin servidor ni instalación.

USO
---
Abre index.html en Chrome, Edge o Firefox.
La expresión a(b+c)* y las cadenas de prueba ya aparecen cargadas al iniciar.
