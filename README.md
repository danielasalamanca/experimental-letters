# Letras experimentales

Editor web para crear letras sobre una grilla de círculos. Cada celda rellena
dibuja la estrella cóncava que queda entre cuatro círculos vecinos; la
curvatura de esos círculos define el carácter de la letra.

**Abrir el editor:** https://danielasalamanca.github.io/experimental-letters/

## Qué se puede hacer

### Dibujo
- Clic o arrastre sobre la grilla para rellenar celdas; si empiezas sobre una
  celda rellena, el arrastre borra.
- **Columnas:** ancho del dibujo del glifo, en celdas.
- **Invertir**, **Limpiar**, **Deshacer** y **Rehacer**
  (Cmd/Ctrl + Z y Cmd/Ctrl + Shift + Z).
- **Guardar letra:** guarda una copia en "Mis letras". Clic para cargarla,
  doble clic para borrarla.

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
  su **curvatura propia** (marcada con un punto azul en "Mis letras") y volver
  con **Usar curvatura global**.
- **Unión mínima** (activada por defecto, 15 u): engrosa las puntas donde dos
  estrellas solo se tocan, para que queden unidas con al menos ese grosor. El
  lienzo la muestra mientras dibujas, así lo que ves es lo que se exporta.
- Colores de tinta y fondo.

### Exportar
- **SVG** y **PNG** del glifo, con las guías y métricas que estén visibles.

Todo se guarda automáticamente en el navegador. Si usaste la versión anterior,
tu letra pasa a la "a" y tus letras guardadas aparecen en "Mis letras".

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
- **Kerning:** ajuste del espacio entre un par concreto de letras, por
  ejemplo "AV" o "To".

## Desarrollo

Es un sitio estático sin paso de compilación: HTML, CSS y módulos de
JavaScript nativos en `js/`.

```bash
python3 -m http.server 8123
```

```bash
npm test
```

Los tests (`node --test`, sin dependencias) cubren la geometría, la migración
de datos y el ajuste de glifos a métricas.
