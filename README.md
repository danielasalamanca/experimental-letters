# Letras experimentales

Editor web para crear letras sobre grillas modulares. Hay dos tipos de
grilla:

- **Círculos (estrellas):** cada celda rellena dibuja la estrella cóncava que
  queda entre cuatro círculos vecinos; la curvatura de esos círculos define el
  carácter de la letra.
- **Puntos (cuadrados):** una grilla de puntos, como la de un cuaderno
  punteado, donde cada celda es un cuadrado. Las esquinas se pueden redondear
  y la letra puede ser rellena o solo un **contorno** que recorre el borde de
  los cuadrados.

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
- **Copiar dibujo desde otro glifo** (panel Glifo): por ejemplo, de la "n" a
  la "h" como punto de partida.
- **Fondo:** muestra otro glifo en azul transparente detrás del que dibujas
  (por ejemplo, la "n" detrás de la "m").
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

La exportación usa [opentype.js](https://github.com/opentypejs/opentype.js)
2.0.0 (licencia MIT), incluido en `js/vendor/`; la tabla de kerning GPOS la
escribe `js/otf.js`, porque opentype.js no la genera.

Los tests (`node --test`, sin dependencias) cubren la geometría, la migración
de datos, la biblioteca de tipografías, el ajuste de glifos a métricas, el
set de caracteres, los
componentes, las herramientas de dibujo (espejo, selección y trazos) y la
composición de texto con kerning, y la exportación: comparan los contornos
con la forma dibujada en miles de puntos (sin superposiciones ni dirección
invertida) y leen la fuente generada para comprobar glifos, nombres, anchos,
kerning y sumas de verificación.
