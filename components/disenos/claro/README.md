# Propuesta de diseño «CLARO Y NÍTIDO»

**La idea en una frase:** el ERP pasa a fondo papel con tinta oscura, tres niveles de texto en vez de dieciséis y el naranja partido en dos usos —relleno intacto, texto oscurecido—, para que quepa un 37 % más de filas leyendo con letra más grande.

**Modo principal: el CLARO.** El oscuro es el alternativo, al revés de hoy. El motivo no es el gusto: aquí se trabaja de día, en un despacho iluminado, sobre tablas de miles de filas. Con luz ambiente alta, un fondo oscuro obliga a la pupila a abrirse por el entorno y a cerrarse por la pantalla, y eso es lo que cansa a las tres horas. Además, es lo que se espera de una herramienta profesional cuando se enseña en una reunión con un cliente.

Los dos modos están **declarados enteros y por separado** (`[data-modo="claro"]` y `[data-modo="oscuro"]` en `estilos.ts`). No hay capa de traducción de uno a otro. Es justo lo que hoy hace `app/globals.css`, y por eso `glass-card` acaba siendo blanco sobre blanco en tema claro: 188 tarjetas de 55 ficheros sin borde ni superficie.

---

## Cómo verla

```tsx
import Propuesta from '@/components/disenos/claro'
export default function Page() { return <Propuesta /> }
```

Nada de esta carpeta toca `app/globals.css`, ni el layout, ni ningún componente del ERP. Todo el CSS va con prefijo `lsd-` y bajo `.lsd-raiz`, sin un solo selector de elemento.

La barra de arriba del todo no es parte del diseño: es el mando para comparar. Lleva las tres pantallas, el interruptor claro/oscuro y **«Sin color»**, que pinta la pantalla entera en gris para comprobar el criterio 5.

---

## 1. La escala tipográfica

Cinco tamaños y tres grosores, contra los **28 tamaños** y 4 grosores de hoy (y dos de los seis pesos de Inter que se descargan hoy no se usan nunca).

| Nivel | px | Grosor | Para qué |
|---|---|---|---|
| Título | 20 | 600 | El h1 de la pantalla. Uno por pantalla, y no vuelve a aparecer. **Hoy son 36 px.** |
| Cifra | 17 | 600 | El número de un indicador. Siempre tabular. |
| **Cuerpo** | **13** | 400 | **EL DATO**: celdas de tabla, valores, campos. Hoy este texto es de 11 o 12 px. |
| Apoyo | 12 | 400 | Contexto: descripciones, notas al pie, ayudas, botones. |
| Etiqueta | 11 | 600 | Cabecera de columna y etiqueta de campo, en versales. Hoy son 10 px al 35-40 % de opacidad. |

El dato **sube** de 11-12 px a 13 px y aun así caben más filas. La densidad no se gana apretando la letra, se gana quitando cromo.

### Los niveles de tinta: TRES

| Nivel | Claro | Oscuro | Para qué |
|---|---|---|---|
| Tinta 1 | `#17140F` | `#F7F3ED` | El dato. Nombres, cifras, lo que se viene a leer. |
| Tinta 2 | `#554E45` | `#B7AEA2` | Contexto: notas, descripciones, etiquetas de campo. |
| Tinta 3 | `#6B6357` | `#A0978B` | Metadatos: cabeceras de columna, ayudas, marcadores, «no hay dato». |

**No hay un cuarto nivel, y no es un olvido.** Entre 4,5:1 y 18:1 no caben cuatro grises que alguien pueda distinguir de verdad. Cuando algo tiene que pesar menos, se cambia el tamaño o el grosor, no la opacidad. Eso es lo que evita volver a los dieciséis niveles.

---

## 2. La paleta

| Token | Claro | Oscuro | Para qué sirve |
|---|---|---|---|
| `lienzo` | `#F2EEE7` | `#131110` | Fondo de página. **Papel cálido, no blanco puro.** |
| `papel` | `#FFFFFF` | `#1C1917` | Superficie de trabajo: tablas, cajas, menú, barra. |
| `papel2` | `#FAF7F2` | `#232019` | Cabecera de tabla, fila bajo el ratón y (solo en oscuro) el rayado. |
| `selec` | `#EFE7DA` | `#33291C` | Fila seleccionada. Neutro a propósito. |
| **`marca`** | **`#FF6600`** | **`#FF6600`** | **El naranja, INTACTO.** Solo como relleno y como gráfico. |
| `marca-texto` | `#A84300` | `#FF9552` | El naranja cuando es texto o icono. |
| `sobre-marca` | `#17140F` | `#17140F` | La etiqueta encima del relleno naranja. Oscura, nunca blanca. |
| `lavado` | `#FFE2CC` | `#3A2410` | Fondo naranja suave del módulo activo del menú. **Es decoración, no un canal:** contra el papel blanco da 1,24:1, así que no se cuenta entre las señales de «dónde estoy». Los que cuentan son el filo y la etiqueta, los dos en `marca-texto` a 4,90:1. |
| `regla` | `#E6DFD3` | `#292521` | La línea entre filas. |
| `regla5` | `#D6CDBD` | `#38322B` | La línea reforzada de cada cinco filas. |
| `borde` | `#D8D0C1` | `#35302A` | Borde estructural. **Aquí no hay sombras.** |
| `aviso` / `error` / `ok` | `#7E5C00` / `#AB211A` / `#0E6B39` | `#F2C33C` / `#FF9089` / `#54DC91` | Ojo con esto / roto / confirmado. |

El papel es **cálido**, no gris azulado. Es lo que separa esto de un panel de administración genérico y lo que hace que el naranja de la marca no parezca pegado encima: comparten familia.

### El naranja: cómo se resuelve sobre fondo claro

Este es el problema central de la dirección. `#FF6600` da **2,94:1** sobre blanco, **2,70:1** sobre el fondo de página claro de hoy y **2,57:1** sobre la tarjeta clara de hoy. No llega a 4,5:1 ni acercándose, y ni siquiera al 3:1 de texto grande.

Se parte en **dos tokens con reglas distintas**:

1. **`marca` = `#FF6600`, sin tocar, solo como RELLENO o como gráfico sin texto.** Donde hay etiqueta encima, la etiqueta es oscura: `#17140F` sobre `#FF6600` da **6,26:1**. Hoy el botón principal del ERP —160 instancias de `<Button>` más 32 de `primaryButton`— lleva texto blanco, que es **2,94:1**. Se arregla cambiando la etiqueta, no el naranja.
2. **`marca-texto` = `#A84300` cuando el naranja es TEXTO o icono sobre claro.** Mismo tono (24°) y misma saturación (100 %); lo único que baja es la luminosidad. Da **6,06:1** sobre papel blanco y **4,93:1** en el peor fondo (la fila seleccionada). En oscuro el equivalente es `#FF9552`, 8,06:1.

**Dónde SÍ va el naranja** (y es toda la lista):
- El raíl de 3 px del módulo activo del menú, con su etiqueta y su fondo lavado.
- El botón principal de la pantalla. **Uno por pantalla.**
- El anillo de foco. Es el único sitio donde no compite con nada.
- El contador vivo del menú (los leads web sin abrir).
- Un solo indicador de la cabecera: el que pide acción hoy.
- El borde izquierdo de las tarjetas de «lo que hay que atender» en Inicio.
- El nombre de la fila seleccionada de una tabla.

**Dónde NO va**, y hoy sí:
- Los 18 iconos de la rejilla de inicio, todos idénticos. Es la prueba más clara de que el acento había dejado de significar nada.
- El chip de filtro encendido. Un filtro es un estado tuyo, no un aviso: va en tinta llena.
- El tinte de la fila seleccionada, que hoy compite con el naranja de «En seguimiento» y con el del chip activo.
- Los títulos de sección, los hover y los bordes decorativos.

De **720 apariciones literales** de `#FF6600` se pasa a unas pocas por pantalla.

---

## 3. Contraste medido (WCAG 2.1)

Calculado componiendo cada color contra la superficie real. La columna de cada modo es el **peor caso** sobre sus cuatro superficies (papel, lienzo, papel2 y fila seleccionada). Umbral **4,5:1**: el texto más grande de una celda son 13 px, así que nada de esto califica como «texto grande».

| Combinación | Claro | Oscuro | Hoy, claro | Hoy, oscuro |
|---|---|---|---|---|
| Tinta 1 — el dato | **14,97** ✅ | **12,88** ✅ | — | — |
| Tinta 2 — notas y etiquetas de campo | **6,68** ✅ | **6,50** ✅ | 4,06 ❌ | 2,86 ❌ |
| Tinta 3 — cabecera de columna | **4,82** ✅ | **4,95** ✅ | 4,06 ❌ | 3,38 ❌ |
| Naranja de TEXTO | **4,93** ✅ | **6,56** ✅ | 2,57 ❌ | 6,62 ✅ |
| Etiqueta del botón principal sobre `#FF6600` | **6,26** ✅ | **6,26** ✅ | 2,94 ❌ | 2,94 ❌ |
| Módulo activo del menú | **4,90** ✅ | **6,72** ✅ | 2,43 ❌ | 6,62 ✅ |
| Aviso sobre su fondo | **5,57** ✅ | **9,14** ✅ | 3,86 ❌ | 10,12 ✅ |
| Error sobre su fondo | **5,86** ✅ | **7,42** ✅ | 4,42 ❌ | 8,36 ✅ |
| Correcto sobre su fondo | **5,62** ✅ | **8,73** ✅ | 3,78 ❌ | 10,01 ✅ |

**Todo el texto de la propuesta pasa 4,5:1 en los dos modos, sin una sola excepción.** Hoy fallan 682 usos de `text-white/XX` en oscuro (el 31 %) y 804 en claro (el 37 %).

Nada pasa «por los pelos»: el peor valor de toda la propuesta es 4,82. Hoy el `text-white/45` pasa por 0,02 en oscuro y suspende en claro.

### Los siete estados de Cold Calling

| Estado | Raíl claro (≥3) | Texto claro (≥4,5) | Raíl oscuro (≥3) | Texto oscuro (≥4,5) |
|---|---|---|---|---|
| Sin contactar | — sin raíl | 6,13 ✅ | — sin raíl | 6,53 ✅ |
| No contesta | 3,08 ✅ | 5,01 ✅ | 7,43 ✅ | 8,58 ✅ |
| Rellamada programada | 3,81 ✅ | 5,89 ✅ | 5,87 ✅ | 8,18 ✅ |
| Info enviada | 4,27 ✅ | 6,08 ✅ | 4,12 ✅ | 6,60 ✅ |
| En seguimiento | 3,90 ✅ | 5,71 ✅ | 5,08 ✅ | 7,08 ✅ |
| Cita cualificada | 3,73 ✅ | 5,38 ✅ | 6,25 ✅ | 8,15 ✅ |
| No le interesa | 4,30 ✅ | 5,77 ✅ | 3,78 ✅ | 6,51 ✅ |

**Contra qué está medido el raíl, que es donde estuvo mal.** El raíl no vive sobre el lienzo
de la página: vive dentro de la celda congelada, cuyo fondo es papel, papel2 al pasar por
encima o **selec** en la fila elegida. El peor de esos tres es siempre la fila seleccionada,
y es el que va en la tabla. Antes esta columna estaba medida contra el lienzo —una superficie
sobre la que el raíl no aparece nunca— y se adjudicaba entre 0,24 y 0,26 de margen que no
tenía; la de oscuro estaba medida solo contra papel, o sea el mejor caso y no el peor. El
caso más apretado real es «No contesta» en claro, a **3,08:1**: pasa, pero por un 3 %, no por
un 9 %. «Sin contactar» no lleva raíl a propósito —todavía no ha pasado nada—, así que no se
declara ratio de algo que no se dibuja.

**Hallazgo que conviene decir en voz alta:** en OSCURO el raíl usa el hue **crudo** del Excel y los seis que se pintan pasan de 3:1, así que el código de color aprendido se conserva entero. En CLARO no se puede: esos mismos tonos sobre papel dan 1,92:1 el amarillo `#EAB308`, 2,28 el verde `#22C55E` y 2,43 el cian `#06B6D4`. Hay que bajarles la luminosidad, y se hace **sin mover el tono más de 7°**. Es la misma pelea que `globals.css` ya tiene documentada con el ámbar, resuelta para los siete de golpe.

---

## 4. Densidad: filas por pantalla

Medido **en navegador** contra una réplica del marcado de estos mismos componentes —mismo CSS, leído del propio `estilos.ts`; mismas doce columnas; mismos controles dentro de las celdas—, no estimado. Las cifras de «hoy» son las del informe de diagnóstico, medidas igual.

### Cold Calling, vista tabla

| Alto de ventana | Equivale a | Hoy | Propuesta | Diferencia |
|---|---|---|---|---|
| 1080 px | monitor 1080 a pantalla completa | 19 | **26** | **+7 (+37 %)** |
| 940 px | monitor 1920×1080 con Chrome y la barra de macOS | 15 | **21** | +6 (+40 %) |
| 900 px | | 14 | **20** | +6 (+43 %) |
| 780 px | portátil 1440×900 con Chrome | 10 | **15** | +5 (+50 %) |

**Y con el dato a 13 px en vez de a 11-12.**

De dónde sale:

| | Hoy | Propuesta |
|---|---|---|
| Alto de fila | 35,5 px | **32 px** |
| Cabecera de tabla | 27,5 px | 30,9 px |
| **Cromo total** | **396,5 px** | **213,4 px** |

La fila baja porque los controles de la celda dejan de meter cromo propio (hoy el 21 % del alto de la fila del catálogo lo pone el `<button>` de la celda editable, no el dato). El cromo baja porque el título y los cuatro indicadores comparten una sola banda de 44 px —hoy son 76 + 69,5— y las tres filas de filtros se juntan en una de 26 px.

En un portátil de 1440 de ancho la barra de filtros pasa a dos líneas y el cromo sube a 245,4 px: por eso ahí se ganan cinco filas y no siete. Está medido, no redondeado a favor.

### Inicio

| Alto de ventana | Hoy | Propuesta |
|---|---|---|
| 1080 px | 14 de 18 | **17 de 17** |
| 940 px | 12 de 18 | **17 de 17** |
| 780 px | 8 de 18 | **17 de 17** |

17 y no 18 porque «Inicio» se queda solo en el menú: una tarjeta que lleva a la pantalla en la que ya estás es ruido. Cada módulo mide **38 px** contra los 202 px de la tarjeta de hoy, y el lanzador entero mide **525 px** contra los 1.408 px de la página actual.

### El menú lateral

Los 18 módulos ocupan **522 px** contra los **1.049 px** de hoy (28 px por ítem en vez de 41). Deja de scrollear solo: hoy, en un portátil de 1440×900, se ven once de dieciocho.

---

## 5. La tabla: claro y oscuro **no** se comportan igual

Esto es lo que hace imposible diseñar en un modo y traducir al otro.

- En **CLARO**, una regla oscura **resta** luz y el ojo la ve enseguida. Con ΔL\* 10,9 ya es una línea firme; si además se raya el fondo, la tabla se convierte en pana. → **reglas sí, rayado NO.**
- En **OSCURO**, una regla clara **suma** luz y se pierde. La misma separación percibida exige más recorrido y aun así queda floja. → **reglas más rayado al 2 %**, que ahí sí ayuda a seguir la fila entre doce columnas.
- En los **dos** modos, una **regla más marcada cada cinco filas** (ΔL\* 17,3 en claro). Da anclas al ojo para recorrer miles de líneas sin el ruido del rayado. Es la pieza que sustituye al tinte de fila.

Se conserva intacto lo que hoy ya funciona: `tabular-nums` en todo lo que se compara en columna (177 usos), la cadena de `min-w-0` que mantiene el scroll horizontal dentro de la caja, el fondo **opaco** de la celda congelada, la escalera de z-index 30/20/10/0, la paginación con «Ver más» en vez de virtualización, la celda que no parece un campo hasta que pasas por encima, los filtros con su salida clara, y el formato español.

---

## 6. Los estados, sin depender del color (criterio 5)

Tres canales y **en este orden**: **forma, palabra y color**. El color es el tercero, nunca el único.

- Cada estado tiene su **icono propio**: círculo hueco para «Sin contactar», teléfono tachado para «No contesta», calendario con reloj para «Rellamada programada», sobre para «Info enviada», llama para «En seguimiento», calendario con tick para «Cita cualificada», prohibido para «No le interesa».
- La **palabra en español** va siempre, como hoy, y se conservan los `HINTS` que explican cada estado.
- El **color** llega en tercer lugar, en el texto y en un raíl de 3 px pegado al borde de la fila.

**Lo que se quita: el tinte de la fila entera al 8 % de alfa.** Con siete tonos a esa saturación y deuteranopía, `#EAB308` (no contesta), `#F97316` (en seguimiento) y `#22C55E` (cita cualificada) son el mismo beige. El raíl de 3 px hace el mismo trabajo —barrer la lista de un vistazo— con el color a plena saturación y sin lavar doce columnas de texto.

**En los frenos** del perfil, «puesto» y «apagado» se distinguen por tres cosas a la vez: escudo lleno contra escudo tachado, la palabra PUESTO o APAGADO, y el borde de la caja continuo contra discontinuo. Hoy la única diferencia es un marcador de posición gris.

**En las ejecuciones**, `sin_cambios` y `simulacro` siguen compartiendo el gris **a propósito** —los dos significan que no ha salido nada hacia Amazon, y pintar `simulacro` de verde es cómo se pasan tres semanas creyendo que la automatización está en marcha—, pero ahora tienen icono distinto: una raya contra un matraz. Hoy son dos pastillas idénticas que solo se diferencian leyendo la palabra.

**La comprobación está en la app:** el botón «Sin color» del mando pinta la pantalla entera en gris. Se pinta entera y no solo los iconos, porque medio grayscale deja el texto del estado en color y ese es justo el canal que se está poniendo a prueba.

---

## 7. Qué ganas

- Siete filas más de tabla en un monitor de 1080 (26 contra 19) y cinco más en un portátil (15 contra 10), **y encima con el dato a 13 px en vez de a 11 o 12**.
- Todo el texto pasa 4,5:1 en los dos modos. Hoy fallan 682 usos en oscuro (31 %) y 804 en claro (37 %).
- El botón principal pasa de 2,94:1 a 6,26:1 **sin tocar el `#FF6600`**: cambia la etiqueta, no el naranja.
- En tema claro se vuelve a ver en qué módulo estás: 4,90:1 contra los 2,43:1 de hoy.
- Tres niveles de tinta en vez de dieciséis; cinco tamaños de letra en vez de veintiocho.
- Los 18 módulos caben en el menú sin que el menú scrollee: 522 px contra 1.049.
- Los estados se leen sin color, y hay un interruptor para comprobarlo.
- Los dos modos declarados enteros y por separado: ninguna superficie se queda sin definir, como le pasa hoy a `glass-card`.
- Aparece un buscador global (Ctrl K) que hoy no existe: 0 resultados de `cmdk`, `CommandPalette` o `Ctrl+K` en el repositorio.

## 8. Qué pierdes

Sin adornos.

- **Se va el cristal.** Nada de `backdrop-filter`, ni el fondo animado de `body::before`, ni las tarjetas de 24 px de radio. La primera impresión es más sobria. Quien enseñe el ERP en una reunión pierde el efecto y gana una tabla que se lee; si lo que se quiere es impresionar en la captura, esta propuesta es peor.
- **El naranja aparece muchísimo menos**: de 720 apariciones a unas pocas por pantalla. Al principio va a parecer que la marca se ha diluido. Es exactamente el objetivo, pero conviene decirlo antes de que lo diga otro.
- **El naranja de texto sobre claro (`#A84300`) es un naranja quemado**, y al lado del `#FF6600` se ve apagado. No hay alternativa: el tono de marca a plena luminosidad no llega a 4,5:1 sobre blanco. O se oscurece, o no se lee.
- **Los colores aprendidos del Excel se conservan tal cual en oscuro, pero en claro hay que oscurecerlos.** El amarillo `#EAB308` baja a `#A87C00` y a esa luminosidad parece más ocre que amarillo. El equipo lo va a notar.
- **La fila deja de teñirse entera.** Quien venga del Excel y barra la lista por manchas de color lo va a echar de menos la primera semana. El raíl de 3 px hace el mismo trabajo con menos ruido, pero es un hábito que hay que cambiar.
- **La barra superior cuesta 48 px fijos** que hoy no se pagan. Se recuperan de sobra al quitar el bloque de título de cada pantalla, pero es cromo nuevo y en una pantalla de portátil se nota.
- **Tres niveles de tinta obligan a decidir.** Hoy, cuando algo tiene que pesar un poco menos, se baja la opacidad y listo. Aquí hay que elegir entre tamaño, grosor o nivel, y a veces no habrá un hueco cómodo. La disciplina es el precio de que el sistema no vuelva a tener dieciséis grises.
- **Adoptarlo de verdad es reescribir 3.118 declaraciones de color de texto y 720 de naranja.** Esto es una maqueta de tres pantallas: el coste real está en las otras quince. Lo barato sería centralizar primero los cinco `shared.ts` **conservando sus nombres** (`primaryButton`, `TH`, `cellShell`, `tableShell`…), porque el equipo ya los usa y cambiarlos son 3.000 líneas en cinco módulos.
- **La rejilla de inicio pasa a lista.** Se gana muchísimo espacio y se pierde el «escaparate»: 18 tarjetas grandes comunican «este ERP hace muchas cosas», y una lista de 38 px no. Para quien entra por primera vez, la versión de hoy impresiona más.

---

## Ficheros

| Fichero | Qué es |
|---|---|
| `estilos.ts` | La hoja de estilo entera como cadena. Prefijo `lsd-`, los dos modos declarados por separado. **No puede contener acentos graves: es una plantilla de cadena.** |
| `memoria.ts` | Idea, escala, paleta, ratios medidos, densidad y el balance. Lo que pinta la pantalla «La ficha del diseño». |
| `datos.ts` | Contenido real del ERP: los 18 módulos agrupados, 30 leads, el perfil de Shoplamp, los formatos españoles. |
| `Estados.tsx` | Los estados con su icono, su palabra y su pista. |
| `Marco.tsx` | Barra superior, menú lateral e inyección del `<style>`. |
| `PantallaInicio.tsx` | Pantalla 1 — la rejilla de inicio. |
| `PantallaColdCalling.tsx` | Pantalla 2 — la tabla larga. |
| `PantallaPerfil.tsx` | Pantalla 3 — el formulario denso. |
| `Ficha.tsx` | La memoria pintada dentro de la app. |
| `Propuesta.tsx` | El envoltorio con el mando de comparación. `export default`. |
