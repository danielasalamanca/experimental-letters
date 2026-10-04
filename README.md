# Letras experimentales

Editor web para crear letras sobre una grilla de círculos. Cada celda rellena
dibuja la estrella cóncava que queda entre cuatro círculos vecinos; la
curvatura de esos círculos define el carácter de la letra.

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
- La fuente usa un sistema de **UPM** (por defecto 1000 unidades por em).
- Cada celda mide un número fijo de unidades (por defecto 50), así que la
  grilla queda mapeada a las unidades de la fuente.

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
- **Curvatura global** para toda la fuente, con la opción de darle a un glifo
  su **curvatura propia** (marcada con un punto azul en el mapa) y volver
  con **Usar curvatura global**.
- **Unión mínima** (activada por defecto, 15 u): engrosa las puntas donde dos
  estrellas solo se tocan, para que queden unidas con al menos ese grosor. El
  lienzo la muestra mientras dibujas, así lo que ves es lo que se exporta.
- Colores de tinta y fondo.

### Exportar
- **SVG** y **PNG** del glifo abierto, con las guías y métricas que estén
  visibles.

Todo se guarda automáticamente en el navegador. Si usaste la primera versión,
tu letra pasa a la "a" y tus letras guardadas aparecen en "Borradores".

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

Los tests (`node --test`, sin dependencias) cubren la geometría, la migración
de datos, el ajuste de glifos a métricas, el set de caracteres, los
componentes y las herramientas de dibujo (espejo, selección y trazos).
