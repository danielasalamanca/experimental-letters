# Letras experimentales

Editor web para crear letras sobre grillas modulares. Hay dos tipos de
grilla:

- **Círculos (estrellas):** cada celda rellena dibuja la estrella cóncava que
  queda entre cuatro círculos vecinos; la curvatura de esos círculos define el
  carácter de la letra.
- **Puntos (cuadrados):** una grilla de puntos, como la de un cuaderno
  punteado, donde cada celda es un cuadrado. Las esquinas se pueden redondear
  —todas a la vez o una por una, con radios de varias celdas para hacer arcos,
  panzas y contraformas redondas, al estilo de los alfabetos geométricos
  modulares— y la letra puede ser rellena o solo un **contorno** que recorre
  el borde de los cuadrados.

**Abrir el editor:** https://danielasalamanca.github.io/experimental-letters/

## Qué se puede hacer

### Mapa de caracteres y glifos
- A la izquierda está el set completo: A–Z, a–z, 0–9, puntuación básica
  (. , ; : ! ? - ' " ( )), ñ, Ñ, las vocales acentuadas (á é í ó ú), los
  acentos usados como componentes (´ y ˜) y el espacio.
- Cada celda muestra la miniatura del glifo, o el carácter en gris si está
  vacío. Clic para abrirlo en el editor.
- Marcas en las celdas: **punto azul** = curvatura propia; **cuadrado verde**
  = glifo compuesto.
- Panel **Glifo**: carácter y código Unicode, columnas, **márgenes laterales**
  izquierdo y derecho (también se arrastran en el lienzo desde sus etiquetas
  verdes, en pasos de una décima de celda) y el **ancho de avance**
  resultante.
- **Componentes:** un glifo puede reutilizar otro con un desplazamiento en
  columnas (x) y filas (y). Las vocales acentuadas y la ñ/Ñ ya vienen como
  letra + acento, así que al editar la "a" o el acento se actualiza la "á".
  En el lienzo, lo que viene de componentes se ve en gris. **Descomponer**
  copia todo al dibujo propio del glifo.

### Dibujo y herramientas
- **Nodos (A)**, como la selección directa de Illustrator: muestra los puntos
  del contorno real de la letra (con sus piezas y esquinas).
  - **Arrastra un punto** para moverlo; se ajusta a los puntos y medios puntos
    de la grilla al acercarse (**Alt**: sin ajuste; **Shift**: horizontal,
    vertical o a 45°).
  - **Clic** elige un punto, **Shift + clic** suma o quita, y arrastrar en un
    lugar vacío elige varios con un rectángulo. **Cmd/Ctrl + A** los elige
    todos; las **flechas** los mueven ¼ de celda (Shift: 1 celda); **Supr**
    los borra; **Esc** quita la selección.
  - Un punto elegido muestra sus **manijas** (curvas Bézier) para
    arrastrarlas; en un punto suave las dos se mueven juntas (Alt las separa).
  - **＋ Agregar nodo** (aparece al elegir Nodos): con el botón activo, un
    punto sigue al puntero por el borde de la letra y un **clic** agrega ahí
    un nodo, que puedes arrastrar sin soltar. **Esc** sale del modo. También
    sirve el **doble clic en un tramo**.
  - **− Quitar nodo** borra los puntos elegidos (igual que Supr) y
    **Esquina ↔ Curva** los cambia entre esquina y curva (igual que el
    doble clic en un punto).
  - Con el **espejo** activado, el punto simétrico se mueve igual.
  - **▭ Rectángulo** y **◯ Elipse**: arrastra para dibujar una forma nueva
    encima (se ajusta a puntos y medios puntos de la grilla; Shift: cuadrado
    o círculo; Alt: libre).
  - **Buscatrazos**, como el de Illustrator, sobre las formas elegidas (las
    que tienen algún punto elegido; sin selección, todas). Con una sola forma
    elegida —por ejemplo, la que acabas de dibujar— la combina con todas las
    demás, como la de más arriba:
    - **Unir:** junta las formas en una.
    - **Restar frente:** la forma de arriba recorta a las de abajo (por
      ejemplo, una elipse que se vuelve contraforma).
    - **Intersecar:** deja solo lo que tienen en común.
    - **Excluir:** quita las partes donde se superponen.
    Las curvas se conservan como curvas.
  - La herramienta **Esquinas** también funciona en letras editadas con
    nodos: el redondeo queda "vivo" (los nodos siguen en su punto y el arco
    se aplica encima) y, si mueves el nodo, su redondeo lo acompaña.
  - La primera vez que cambias un punto, la letra pasa a ser un contorno de
    nodos (como expandir en Illustrator) y se marca con un cuadradito azul en
    el mapa. **Volver a la grilla** (panel Glifo) la devuelve a su dibujo en
    la grilla; **Editar con nodos** la convierte sin mover nada. Las letras
    compuestas (á, ñ…) siguen a la letra editada, y al exportar el .otf los
    contornos que se superponen se unen.
- **Dibujar (B):** clic o arrastre sobre la grilla para rellenar celdas; si
  empiezas sobre una celda rellena, el arrastre borra.
- **Espejo ↔ y ↕:** al dibujar o borrar se repite la celda reflejada
  izquierda–derecha y/o arriba–abajo (útil para A, H, O, V). El eje se ve como
  una línea magenta. El eje arriba–abajo puede ser automático (altura de x
  para minúsculas, mayúsculas para mayúsculas y números) o elegirse a mano.
- **Seleccionar (V):** arrastra un rectángulo o haz clic en una celda
  (Shift suma o quita). **Doble clic** selecciona el trazo completo (todas las
  celdas unidas por sus lados). Arrastra la selección para moverla, usa las
  **flechas** para moverla de a una celda y **Supr/Retroceso** para borrarla.
  **Esc** quita la selección y **Cmd/Ctrl + A** selecciona todo.
- **Copiar y pegar:** Cmd/Ctrl + C, X y V, también entre glifos (sin
  selección se copia el dibujo completo).
- **Las formas viajan completas:** al mover (arrastre o flechas), copiar,
  cortar, pegar o borrar una selección, se llevan también sus **esquinas
  redondeadas** (las que caen en las celdas elegidas o en sus bordes) y sus
  **piezas** (las que quedan dentro del área elegida). Lo pegado queda
  "flotando" sobre el dibujo hasta que eliges otra cosa: arrástralo o
  muévelo con las flechas y el original queda en su lugar.
- Con la herramienta **Nodos**, Cmd/Ctrl + C, X y V copian, cortan y pegan
  contornos completos (los que tienen un punto elegido, o todos); lo pegado
  queda elegido para moverlo.
- **Copiar dibujo desde otro glifo** (panel Glifo): por ejemplo, de la "n" a
  la "h" como punto de partida.
- **Esquinas (E)** (grilla de puntos): muestra las esquinas de la letra como
  puntos. **Arrastra** una esquina hacia adentro para elegir su radio (en
  medias celdas), o haz **clic** para aplicarle el radio del control **Radio**
  (de ½ a 12 celdas; al máximo, que es el valor inicial, se redondea todo lo
  que la forma permite). Otro clic con el mismo radio la devuelve al redondeo
  global y **Shift + clic** la deja en punta. Junto a cada esquina redondeada
  se ve el radio que realmente obtuvo. Un radio exterior de 2 alrededor de un interior de 1 da un
  arco concéntrico de una celda de grosor (como la "n" de un alfabeto
  modular). Cada radio se limita solo para no comerse una contraforma ni la
  esquina vecina, y en estilo contorno para que el trazo quepa. Respeta el
  espejo, y las letras compuestas (á, ñ…) heredan las esquinas de sus
  componentes.
- **Piezas (P)** (grilla de puntos): piezas geométricas que **agregan** o
  **recortan** tinta encima de las celdas, para diagonales y curvas que la
  grilla sola no permite. Arrastra de un punto de la grilla a otro: la pieza
  ocupa ese rectángulo y nace en la esquina donde empezaste.
  - **Triángulo:** ángulo recto en esa esquina; recortado a los lados de un
    bloque da diagonales de cualquier inclinación (una "A" trapezoidal).
  - **Cuarto de elipse:** centrado en esa esquina (panzas, brazos redondos,
    muescas con fondo redondo).
  - **Esquina curva:** lo que queda entre esa esquina y un cuarto de elipse;
    recortado redondea una esquina con radios distintos en alto y ancho, por
    ejemplo el brazo de una "K" que baja curvo hasta tocar el asta.
  - En una letra con piezas, el redondeo (global y de la herramienta
    **Esquinas**) se aplica al final, sobre la forma ya recortada: las
    esquinas que crean las diagonales también se pueden redondear, y los
    puntos de la herramienta Esquinas aparecen donde la letra realmente
    tiene esquinas.
  - **Nodos:** con la herramienta Piezas, cada pieza muestra sus nodos como
    cuadraditos. Arrástralos para cambiar una diagonal o el tamaño de un arco;
    se ajustan a los puntos de la grilla (con **Shift**, a medias celdas). Con
    el espejo activado, la pieza reflejada se mueve igual. En un triángulo
    puedes mover sus tres nodos: la pieza cubre todo lo que queda del lado de
    su esquina hasta el borde de su rectángulo, así mover el extremo de una
    diagonal nunca deja una astilla en el borde. En un cuarto de elipse o una
    esquina curva, los extremos del arco lo hacen más ancho o más alto.
  - Las piezas se aplican en orden y respetan el espejo. Clic en una pieza
    para elegirla y **Supr** para borrarla; también aparecen en el panel
    Glifo, con su botón para quitarlas.
- **Fondo:** muestra otro glifo en azul transparente detrás del que dibujas
  (por ejemplo, la "n" detrás de la "m").
- **Ver solo la letra:** mientras mantienes apretada la **barra
  espaciadora**, el lienzo muestra solo la letra, sin grilla, métricas,
  márgenes, nodos ni etiquetas; al soltarla vuelve todo.
- **Zoom y desplazamiento:** Cmd/Ctrl + rueda (o pellizco en el trackpad)
  hace zoom hacia el cursor; con zoom, la rueda desplaza; espacio + arrastre
  o el botón central del mouse también desplazan. Botones −, +, **Ajustar** y
  atajos +, − y 0.
- **Columnas:** ancho del dibujo del glifo, en celdas.
- **Invertir**, **Limpiar**, **Deshacer** y **Rehacer**
  (Cmd/Ctrl + Z y Cmd/Ctrl + Shift + Z). El historial es de toda la fuente:
  deshacer te lleva al glifo donde ocurrió el cambio.
- **Guardar como borrador:** guarda una copia del glifo en "Borradores", al
  final del mapa de caracteres. Clic para copiarla al glifo abierto, doble
  clic para borrarla.

### Grilla y unidades
- **Tipo de grilla** (panel Grilla): círculos o puntos, para toda la fuente.
  Cada glifo puede usar otra en **Grilla de este glifo** (panel Glifo); en el
  mapa de caracteres se marca con un cuadradito naranja. El dibujo (las celdas)
  es el mismo en ambas grillas, así que puedes cambiar de una a otra cuando
  quieras.
- La fuente usa un sistema de **UPM** (por defecto 1000 unidades por em).
- Cada celda mide un número fijo de unidades (por defecto 50), así que la
  grilla queda mapeada a las unidades de la fuente.
- **Opacidad de la grilla:** atenúa los círculos de fondo para ver mejor la
  letra.

### Probar y espaciar
- La barra inferior **Probar** compone en tiempo real lo que escribas con tu
  fuente, usando los anchos de avance, márgenes y kerning reales. Admite
  varias líneas; los caracteres que no están en el set aparecen como una caja
  punteada.
- **Textos de prueba** predefinidos (hamburgefonstiv, HOHOHOH nonono,
  alfabetos, números, pares típicos de kerning y frases en español).
- **Tamaños:** pequeño, mediano y display. **Invertir** cambia tinta y fondo.
- **Kerning:** haz clic entre dos letras del texto (en la mitad derecha de la
  primera o la izquierda de la segunda) para elegir el par; ajústalo con − y +,
  con las flechas ← → (Shift: de a 50 u) o escribiendo el valor. Los pares
  ajustados aparecen como etiquetas debajo; clic para volver a uno.
- **Doble clic** en una letra del texto la abre en el editor.

### Métricas verticales
- Líneas guía con nombre y color: **ascendente**, **altura de mayúsculas**,
  **altura de x**, **línea base** y **descendente**, más franjas suaves de
  **overshoot** sobre la línea base, la altura de x y la de mayúsculas.
- Se editan arrastrando sus etiquetas de color en el lienzo o escribiendo el
  valor en el panel "Métricas". Siempre quedan ancladas a filas enteras.
- Son globales para toda la fuente. Mover una guía **no** cambia los dibujos:
  solo la referencia.
- **Ajustar glifos a métricas:** adapta los dibujos a las métricas nuevas sin
  escalarlos. En cada zona que cambió inserta o quita filas enteras (como en
  una planilla), duplicando o quitando primero las filas que repiten a su
  vecina, como los tramos rectos de un fuste. Antes de aplicar muestra cuántos
  glifos cambiarán, y se puede deshacer.

### Forma
- **Curvatura global** (grilla de círculos) o **redondeo global** de las
  esquinas (grilla de puntos), con la opción de darle a un glifo un valor
  propio (marcado con un punto azul en el mapa) y volver al global.
- Grilla de puntos: las esquinas quedan **en punta** hasta que actives
  **Redondear todas las esquinas**; recién entonces se aplica el redondeo
  global, así puedes dejarlo para el final. Las esquinas redondeadas con la
  herramienta Esquinas y el redondeo propio de un glifo se aplican siempre.
- Grilla de puntos: **Estilo** relleno o contorno, y **grosor del contorno**
  en unidades (hasta casi media celda). El contorno se exporta como tal a la
  fuente.
- **Unión mínima** (grilla de círculos; activada por defecto, 15 u): engrosa las puntas donde dos
  estrellas solo se tocan, para que queden unidas con al menos ese grosor. El
  lienzo la muestra mientras dibujas, así lo que ves es lo que se exporta.
- Colores de tinta y fondo.

### Mis tipografías, proyecto y exportación
- **Tipografía** (arriba del panel Fuente): lista de tus tipografías
  guardadas en este navegador; elige una para abrirla.
  - **Nueva:** empieza una tipografía en blanco con el nombre y la grilla que
    elijas. La actual queda guardada en la lista.
  - **Guardar:** guarda la tipografía abierta (además, cada cambio se guarda
    solo; el panel muestra la hora del último guardado).
  - **Duplicar:** crea una copia y sigues trabajando en ella; el original
    queda intacto.
  - **Eliminar:** la quita del navegador, después de confirmar.
  - Cada tipografía tiene su propio historial de deshacer.
- Panel **Fuente**: nombre de la familia, estilo (Regular, Bold…),
  diseñadora y versión.
- **Descargar .json** guarda un archivo con todo (glifos, métricas, kerning,
  metadatos y preferencias), para respaldar o llevar la tipografía a otro
  computador o navegador. **Abrir .json** la agrega como una tipografía nueva
  de la lista, sin reemplazar la que tenías abierta.
- **Exportar fuente (.otf)**: genera una fuente OpenType instalable (doble
  clic en el archivo) para usar en Illustrator, InDesign, etc.
  - Cada glifo se convierte en contornos cerrados, sin superposiciones y con
    la dirección correcta (exteriores en sentido antihorario y contraformas en
    sentido horario), con la curvatura de cada glifo. Los arcos son curvas
    Bézier, no polígonos.
  - **Con unión mínima** (por defecto): las puntas que solo se tocan quedan
    unidas con el grosor elegido, igual que en el lienzo.
  - **Exportar tal cual**: sin unión; las estrellas que se tocan en un punto
    quedan unidas solo por ese punto.
  - Incluye el kerning (tabla GPOS), los anchos de avance y las métricas.
- **Exportar SVG / PNG** del glifo o del texto de prueba, opcionalmente con
  las líneas de métricas (y la grilla, en el glifo) para presentaciones.

Si usaste la primera versión, tu letra pasa a la "a" y tus letras guardadas
aparecen en "Borradores".

## Glosario

- **UPM (unidades por em):** la cuadrícula invisible de la fuente. Todas las
  medidas (alturas, anchos, espacios) se expresan en estas unidades; lo
  habitual es 1000.
- **Línea base:** la línea sobre la que se apoyan las letras. Es el 0 de las
  medidas verticales.
- **Altura de x:** la altura de las minúsculas sin ascendentes, como x, a, n, o.
- **Altura de mayúsculas:** la altura de las letras como H, E o T.
- **Ascendente / descendente:** cuánto suben los trazos de b, d, h, l y cuánto
  bajan los de g, p, q, y respecto de la línea base.
- **Overshoot (sobrepaso):** las formas redondas (o, s, c) se dibujan un poco
  más allá de la línea base y de la altura de x para que ópticamente parezcan
  del mismo tamaño que las rectas.
- **Sidebearing (margen lateral):** el espacio vacío a la izquierda y a la
  derecha de un glifo, dentro de su ancho de avance.
- **Ancho de avance:** cuánto avanza el cursor después de un glifo: margen
  izquierdo + dibujo + margen derecho.
- **Componente:** un glifo reutilizado dentro de otro (la "a" dentro de la
  "á"), de modo que los cambios se propagan.
- **Kerning:** ajuste del espacio entre un par concreto de letras, por
  ejemplo "AV" o "To".

## Desarrollo

Es un sitio estático sin paso de compilación: HTML, CSS y módulos de
JavaScript nativos en `js/`. En cada publicación hay que subir el número
`?v=` de `index.html` (import map, script y hoja de estilos) para que los
navegadores no mezclen archivos nuevos con otros guardados en caché.

```bash
python3 -m http.server 8123
```

```bash
npm test
```

Las piezas se combinan con [Clipper](https://www.angusj.com/delphi/clipper.php)
(6.4.2, licencia Boost, en `js/vendor/clipper.js`) sobre contornos
aplanados finamente; después `js/pieces.js` vuelve a convertir cada tramo
que venía de una curva en esa misma curva Bézier, así la fuente conserva
curvas reales. (En estilo contorno, la curva interior del trazo de un glifo
con piezas queda como muchos tramos rectos muy cortos.)

La exportación usa [opentype.js](https://github.com/opentypejs/opentype.js)
2.0.0 (licencia MIT), incluido en `js/vendor/`; la tabla de kerning GPOS la
escribe `js/otf.js`, porque opentype.js no la genera.

Los tests (`node --test`, sin dependencias) cubren la geometría, la migración
de datos, la biblioteca de tipografías, la edición con nodos, el ajuste de
glifos a métricas, el
set de caracteres, los
componentes, las herramientas de dibujo (espejo, selección y trazos) y la
composición de texto con kerning, y la exportación: comparan los contornos
con la forma dibujada en miles de puntos (sin superposiciones ni dirección
invertida) y leen la fuente generada para comprobar glifos, nombres, anchos,
kerning y sumas de verificación.
