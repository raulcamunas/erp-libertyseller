# Propuesta «Denso y sobrio»

> **La idea, en una frase:** una herramienta de trabajo y no un escaparate — fila de tabla de 28 px, cuatro niveles de texto todos por encima de 4,5:1 en los dos temas, y el naranja de marca reservado para lo que espera una acción tuya y todavía no la ha tenido.

La referencia es Linear o Height: contraste alto, tipografía pequeña pero muy legible, espaciados cortos y disciplinados, bordes finos en vez de sombras y color casi solo para el estado y la acción. Las tablas son el corazón, porque este equipo se pasa el día dentro de ellas.

**Todos los números de este documento están medidos**, no estimados: los contrastes con `getComputedStyle` sobre el píxel que de verdad pinta el navegador, y las alturas con `getBoundingClientRect` sobre estos mismos componentes.

---

## Cómo se mira

```tsx
'use client'
import { DisenoDenso } from '@/components/disenos/denso'

export default function Pagina() {
  return <DisenoDenso />
}
```

Arriba de la maqueta hay un regulador con las tres pantallas, el interruptor claro/oscuro y **la altura de ventana simulada (1080 · 940 · 780)**. Está ahí porque la densidad no se discute con adjetivos: se pone la tabla a 780 px, que es lo que tiene el portátil de un comercial, y se cuentan las filas. En Cold Calling, la cuenta que sale arriba a la derecha está medida en el DOM en ese momento.

---

## 1. La escala tipográfica

Cinco tamaños y tres grosores. Hoy hay **28 tamaños distintos en dos sistemas paralelos** —`text-sm`/`text-xs` en los módulos viejos, `text-[11px]`/`text-[10px]` en los nuevos, conviviendo en la misma pantalla— y seis pesos cargados de los que dos no se usan nunca.

| clase | px | grosor | para qué |
|---|---|---|---|
| `dz-xl` | 15 | 600 | Título de pantalla y de sección grande. Uno por vista. |
| `dz-l` | 13 | 600 | Cabecera de panel, nombre de módulo, dato destacado. |
| `dz-m` | 12,5 | 400 | **El texto de trabajo**: celdas de tabla, valores, campos. |
| `dz-s` | 11,5 | 400 | Contexto: notas al pie de campo, descripciones, subtítulos. |
| `dz-xs` | 11 | 600 | Rótulos: cabecera de columna, etiqueta de campo, unidades. |

Interlineado: 18 px fijos dentro de una fila de 28; 1,45 en texto corrido; 1,5 en notas.

**Cero mayúsculas.** Hoy hay 236 `uppercase`, casi siempre con `tracking-wider` y a 10 px. A ese tamaño las mayúsculas son la forma más lenta de leer una palabra, y encima ese patrón es a la vez el texto más pequeño y el de menos contraste del ERP: es literalmente la cabecera de columna de todas las tablas y la etiqueta de todos los campos del perfil de stock.

Fuente: Inter, la que ya carga el ERP. No se añade ninguna.

---

## 2. La paleta

### Oscuro — el modo principal

| token | hex | para qué |
|---|---|---|
| `--dz-fondo` | `#0F1114` | La página. Neutro frío, **nunca negro puro**. |
| `--dz-sup` | `#15171B` | Tabla, tarjeta, panel. |
| `--dz-sup2` | `#1A1D22` | Elevación: cabecera de tabla, columna congelada, barra lateral. |
| `--dz-hover` | `#1F232A` | La fila bajo el ratón. |
| `--dz-sel` | `#2A1F14` | La fila en la que estás. |
| `--dz-linea` | `#262A31` | El separador de siempre. |
| `--dz-linea2` | `#343941` | El separador que sí tiene que verse. |
| `--dz-t1` | `#F4F5F7` | **El dato.** |
| `--dz-t2` | `#CBD0D8` | **El dato de al lado.** |
| `--dz-t3` | `#A2A9B4` | **El contexto.** |
| `--dz-t4` | `#8A929E` | **El rótulo.** |
| `--dz-acc` | `#FF6600` | Naranja de texto y de línea. |
| `--dz-acc-relleno` | `#FF6600` | Relleno del botón primario. |
| `--dz-acc-tinta` | `#14161A` | Lo que se escribe encima de ese relleno. |

### Claro — diseñado, no traducido

| token | hex | para qué |
|---|---|---|
| `--dz-fondo` | `#F3F4F6` | La página. |
| `--dz-sup` | `#FFFFFF` | Tabla, tarjeta, panel. |
| `--dz-sup2` | `#F7F8FA` | Elevación. |
| `--dz-hover` | `#EFF1F4` | La fila bajo el ratón. |
| `--dz-sel` | `#FFF1E5` | La fila en la que estás. |
| `--dz-linea` | `#E3E6EA` | El separador de siempre. |
| `--dz-linea2` | `#CDD2D9` | El separador que sí tiene que verse. |
| `--dz-t1` | `#14161A` | El dato. |
| `--dz-t2` | `#383E48` | El dato de al lado. |
| `--dz-t3` | `#525A67` | El contexto. |
| `--dz-t4` | `#666D79` | El rótulo. |
| `--dz-acc` | `#B84900` | Naranja **de texto**. |
| `--dz-acc-graf` | `#D25400` | Naranja de raíl, barra y foco (gráfico, umbral 3:1). |
| `--dz-acc-relleno` | `#FF6600` | **El naranja de marca exacto, sin tocar**, como relleno. |
| `--dz-acc-tinta` | `#14161A` | Encima del relleno. |
| `--dz-acc-borde` | `#D25400` | Filo del botón primario sobre blanco, que si no el relleno no se recorta (2,94:1). |

**Sobre el naranja.** Se queda, y no se desatura: como **relleno** es `#FF6600` exacto en los dos temas, y lo que cambia es lo que va escrito encima —tinta oscura, 6,17:1, en vez del blanco de hoy, que va a 2,94:1 en los 160 `<Button>` y los 32 `primaryButton` del ERP—. Solo cuando el naranja hace de **texto** sobre fondo claro baja a `#B84900`, porque `#FF6600` da 2,94:1 sobre blanco y 2,70:1 sobre el fondo de página claro de hoy, y no pasa ni el umbral de texto grande. Es el mismo tono de marca en dos papeles distintos, no otra marca.

### Los estados: los tonos del Excel, subidos hasta pasar

Los hues son los que el equipo ya tiene aprendido de su Excel; lo único que cambia es la luminosidad, hasta que todos pasan 4,5:1 en los dos temas.

| estado | oscuro | ratio | claro | ratio |
|---|---|---|---|---|
| gris — sin contactar / sin cambios / simulacro | `#9AA2AE` | 6,97 | `#5B6270` | 6,13 |
| amarillo — no contesta / frenado | `#E0B341` | 9,14 | `#7A5A00` | 6,38 |
| cian — rellamada programada | `#3AC8DE` | 8,97 | `#0E6E80` | 5,90 |
| magenta — info enviada | `#E879F9` | 7,29 | `#A21CAF` | 6,32 |
| naranja — en seguimiento | `#FB923C` | 7,93 | `#9A4A00` | 6,26 |
| verde — cita cualificada / enviado | `#4ADE80` | 10,30 | `#116B36` | 6,60 |
| rojo — no le interesa / error | `#F87171` | 6,49 | `#B3261E` | 6,54 |

Hoy, en tema claro, tres de las cuatro píldoras de estado se quedan entre 3,78 y 4,42.

---

## 3. Contraste medido

Leído con `getComputedStyle` sobre el marcado real de estos componentes, componiendo contra la superficie que de verdad hay debajo. Sin alfa, sin `backdrop-filter` y sin la niebla animada de `body::before`, que hoy sube el suelo de la página de `#080808` a `#231207` en los picos y hace que dos celdas idénticas no tengan el mismo contraste según dónde caigan ni a qué segundo sea.

| combinación | oscuro | claro |
|---|---|---|
| L1 · el dato (nombre de tienda, cifra, título) | **16,45** | **18,11** |
| L2 · el dato de al lado (celda normal, campo) | **11,58** | **10,76** |
| L3 · el contexto (empresa, email, nota de campo) | **7,58** | **6,96** |
| L4 · el rótulo — cabecera de columna, sobre su fondo elevado | **5,38** | **4,91** |
| L4 · el rótulo — etiqueta de campo, sobre superficie normal | **5,71** | **5,21** |
| Módulo del menú lateral | 7,14 | 6,55 |
| Botón de icono de la tabla (el nivel más bajo que existe) | 5,71 | 5,21 |
| Chip de filtro apagado | 7,58 | 6,96 |
| Botón primario: tinta sobre el naranja de marca | **6,17** | **6,17** |
| L1 sobre la fila seleccionada | 14,76 | 16,36 |
| Naranja de texto sobre la superficie de tabla | 6,11 | 5,26 |

**El peor par de toda la propuesta es 5,38:1 en oscuro y 4,91:1 en claro.** Hoy fallan 682 usos de `text-white/XX` en oscuro (el 31 %) y 804 en claro (el 37 %), y los que fallan no son adornos: la cabecera de columna de todas las tablas (3,80 / 4,05), las etiquetas y las notas del perfil de stock (3,17 / 4,05), el precio de un FBA que no se puede editar (2,63) y el valor anterior tachado contra el que compruebas si has metido `1499` donde querías `14,99` (3,17).

De dieciséis niveles de texto se baja a **cuatro**. Nadie distingue dieciséis grises; cuatro sí, y cada uno significa una cosa.

---

## 4. Densidad medida

Medido en navegador contra una réplica que usa **la misma hoja de estilo que se envía** (`estilos.ts`), no una aproximación.

| | hoy | esta propuesta |
|---|---|---|
| altura de fila | 35,5 px | **28 px** |
| altura de cabecera | 27,5 px | 26 px |
| cromo por encima y por debajo de la tabla | 396,5 px | **164 px** |

### Filas de Cold Calling que caben en pantalla

| altura de ventana | equivale a | hoy | ahora | |
|---|---|---|---|---|
| 1080 | monitor a pantalla completa | 19 | **32** | +68 % |
| 940 | monitor 1920×1080 con Chrome | 15 | **27** | +80 % |
| 780 | portátil 1440×900 con Chrome | 10 | **22** | **+120 %** |

**Un comercial en su portátil pasa de ver 10 leads de casi 4.000 a ver 22.** Y no se lee peor: el texto de la celda sube de 12 a 12,5 px. Los 7,5 px que se van por fila no son texto — son el cromo de dentro de la celda. Hoy la altura de la fila la manda un `<select>` de 26,5 px metido en un `td py-1`; aquí el control mide 20 y no dibuja una caja hasta que se usa.

### Dónde estaban esos 232 px de cromo

| pieza | hoy | ahora |
|---|---|---|
| padding del layout | 64 | 20 |
| título de pantalla + descripción | 76 | 0 — el título va en la barra superior de 38 px, que además trae las acciones |
| 4 tarjetas de KPI | 69,5 | 28 — una tira de cifras |
| tres filas de filtros | 117 | 32 — una sola fila, y lo que se toca una vez al día detrás de «Filtros» |
| botón «Ver más» | 42,5 | 0 — va dentro del scroll de la tabla |

### Barra lateral

| | hoy | ahora |
|---|---|---|
| ancho | 256 px | **208 px** |
| altura de un ítem | 41 px | **26 px** |
| altura total con los 18 módulos | **1.049 px** | **670 px** |

La de hoy scrollea sola por debajo de 1.049 px de ventana: en un portátil se ven 11 de 18 módulos. La nueva cabe entera en cualquier pantalla del equipo, con los módulos **agrupados** por el trabajo que hacen (Comercial · Cliente y catálogo · Dinero · Equipo y tiempo).

### Pantalla de inicio

| | hoy | ahora |
|---|---|---|
| altura de la página | 1.408 px | **692 px** |
| módulos visibles sin scroll a 780 px | 8 de 18 | **18 de 18** |

---

## 5. Jerarquía: qué cambia en cada pantalla

### Inicio

Había dieciocho tarjetas de 202 px con dieciocho iconos naranjas idénticos para tres líneas de texto cada una. Ningún objeto pesa más que otro, así que la insignia de leads sin abrir —la única información viva de toda la pantalla— compite en igualdad con «Usos horarios».

Ahora la jerarquía la pone **lo que ha cambiado**: arriba, «Hoy», seis líneas con lo que está esperando a alguien, y ahí es donde vive el naranja. Debajo, los dieciocho módulos como lista agrupada a 30 px por línea. Al lado, lo que ha pasado en la agencia desde ayer. La insignia naranja **no se repite** en la lista de módulos: ya está dicha arriba, y repetirla treinta píxeles más abajo es volver a gastar el acento en algo que ya estaba dicho.

### Cold Calling

**Estado sube a la segunda columna**, pegado al ancla. Antes era la cuarta y el estado se leía por el tinte de la fila entera. La primera columna izquierda queda libre para una sola cosa: el raíl naranja de 2 px de **la fila en la que estás**. Con eso desaparece de golpe el choque que había entre el naranja de la fila seleccionada, el naranja del estado «En seguimiento» y el naranja del chip de filtro encendido.

### Perfil de lectura de stock

Etiquetas y notas suben de 3,17:1 a 5,71 y 7,58, y dejan de ir en mayúsculas de 10 px. Y se resuelven las dos cosas que la pantalla no decía:

- **Un freno apagado lo dice con una etiqueta.** Hoy la única diferencia entre «este freno está puesto en 30 %» y «este freno no protege nada» es que la casilla está vacía y hay un marcador de posición gris a 3,17:1. Ahora cada freno lleva su píldora: *Puesto* con un check, *Apagado* con un círculo tachado.
- **Hay confirmación de guardado.** El patrón de «sin botón de guardar» es correcto y se conserva, pero le faltaba la otra mitad: si no hay botón que pulsar, nada te dice que lo tecleado ha quedado escrito. Al salir del campo aparece «Guardado» durante dos segundos en el sitio de la nota —no encima, para que el texto no salte— y el borde parpadea.

También se enseña **qué columna real del fichero se ha llevado cada campo** en la última prueba, al lado del campo y no en otra parte de la pantalla.

---

## 6. Los estados se leen sin color

Orden de lectura: **glifo → palabra → color**. Tapa el color con la mano y las tres pantallas siguen funcionando.

| estado | glifo | palabra |
|---|---|---|
| Sin contactar | círculo vacío | «Sin contactar» |
| No contesta | teléfono tachado | «No contesta» |
| Rellamada programada | calendario con reloj | «Rellamada» |
| Info enviada | sobre | «Info enviada» |
| En seguimiento | flecha ascendente | «Seguimiento» |
| Cita cualificada | check en círculo | «Cita cualificada» |
| No le interesa | aspa en círculo | «No le interesa» |

Y el caso que de verdad lo pone a prueba: **`simulacro` y `sin_cambios` comparten color a propósito** —el gris de «esto NO ha mandado nada a Amazon», una decisión que ya estaba tomada y que hay que respetar— así que **no comparten glifo**: matraz para el ensayo, raya para «no había nada que cambiar». Cuando el color es idéntico, la forma es lo único que queda.

Se quita el tinte de fila de siete hues al 8 % de alfa: con deuteranopía, `#EAB308` (no contesta), `#F97316` (en seguimiento) y `#22C55E` (cita cualificada) a esa opacidad son el mismo beige.

---

## 7. Dónde SÍ va el naranja y dónde NO

**La regla: el naranja marca lo que espera una acción tuya y todavía no la ha tenido.**

**SÍ**
- La cifra que hay que atender hoy (12 rellamadas, 23 leads sin abrir).
- La insignia de un módulo con cosas pendientes, en la barra lateral.
- El raíl de 2 px del módulo en el que estás y de la fila en la que estás.
- El botón primario de la pantalla: uno, y con tinta oscura encima.
- El foco de teclado y el borde de la celda que estás editando.
- El asterisco de campo obligatorio.

**NO**
- Los iconos de los módulos (hoy son 18 iguales solo en la pantalla de inicio).
- Los títulos, los enlaces al pasar por encima y los degradados de botón.
- El estado «En seguimiento», que es naranja **de dominio** y vive en su glifo, no en el cromo.
- Los bordes de tarjeta, las líneas divisorias y los fondos decorativos.

| pantalla | hoy | ahora |
|---|---|---|
| Inicio | 18 iconos + 18 bordes al pasar + 2 insignias | **8 marcas**: 2 líneas urgentes de «Hoy», 4 insignias del menú, el logo y el raíl del módulo activo |
| Cold Calling | chips activos + fila seleccionada + focos + 44 usos literales en el módulo | **4 dentro del área de trabajo**: la cifra urgente, el chip activo, el raíl de la fila y el botón primario |

En el ERP de hoy hay **720 apariciones literales de `#FF6600`** y no hay un solo módulo sin él.

---

## 8. Claro y oscuro

**El principal es el oscuro.** Tres razones:

1. Es el que el equipo lleva usando desde el principio. Cambiar de estética y de polaridad el mismo día son dos cambios, y solo uno de los dos lo ha pedido nadie.
2. Las jornadas de cold calling empiezan a las 07:00 hora de México y terminan de noche; el oscuro es más cómodo en sala con poca luz, que es donde se hacen la mitad de esas horas.
3. Pero el claro **no es una traducción**: son otros veinte valores elegidos uno a uno y con los mismos umbrales. Hoy hay una capa que reinterpreta clases (`html.light .text-white\/70 { … }`), y por eso `glass-card` acaba siendo blanco puro sobre `#F5F5F7` —**1,09:1**, con el borde a 1,01:1— y las 188 tarjetas de 55 ficheros se quedan sin superficie ni borde; la barra lateral tampoco tiene fondo (1,00:1); y en tema claro **no se lee en qué módulo estás** (el ítem activo va a 2,43:1).

En esta propuesta el tema es un atributo (`data-dz-tema`) sobre la raíz propia, así que ninguna de las dos versiones depende de que la otra funcione.

---

## 9. Qué ganas

- **De 10 a 22 filas** en el portátil de un comercial, y el texto de la celda pasa de 12 a 12,5 px.
- **Cuatro niveles de texto** en vez de dieciséis, todos por encima de 4,5:1 en los dos temas.
- La cabecera de columna sube de 3,80:1 a **5,38:1** y deja de ir en mayúsculas de 10 px.
- Las etiquetas y las notas del perfil de stock suben de 3,17:1 a **5,71** y **7,58**.
- El botón primario deja de tener el texto a 2,94:1: tinta oscura sobre el naranja de marca, **6,17:1**.
- En tema claro se vuelve a ver en qué módulo estás.
- **Un solo sistema de botones**, en vez de los dos de hoy que conviven a 20 px de distancia con 16 px de diferencia de altura y tratamientos tipográficos opuestos.
- El estado se lee por glifo y palabra antes que por color, **incluso cuando dos estados comparten color a propósito**.
- La barra lateral cabe entera: 670 px con los 18 módulos frente a 1.049.
- Un freno apagado lo dice con una etiqueta, no con la ausencia de un número.
- Se acaba la niebla animada de 25 s con `blur(120px)` detrás de todo: el contraste de una celda ya no depende de dónde caiga ni de qué segundo sea. Y se apaga el `* { transition: … filter … }` global, que en una tabla de treinta filas son treinta filas animando `filter` a cada movimiento del ratón.

## 10. Qué pierdes

Una propuesta sin desventajas es una propuesta que no se ha pensado. Estas son las de verdad:

1. **El tinte de fila del Excel.** Es la pérdida grande y no se arregla mirando para otro lado: el equipo lleva años leyendo el estado por el color del fondo de la fila, y esa decisión está documentada en el código como deliberada. Se cambia por glifo + palabra en la segunda columna y se deja un interruptor **«Tinte Excel»** para quien lo quiera de vuelta — pero aun así, la primera semana se trabaja más despacio.
2. **Densidad contra dedo gordo.** 28 px de fila con controles de 20 dentro son cómodos con ratón y trackpad, e incómodos con pantalla táctil. Encaja con el criterio que ya tiene el ERP (la versión móvil del catálogo es de solo consulta a propósito), pero cualquier idea de editar desde una tablet se complica.
3. **Menos aire en las pantallas de consulta.** Tesorería, Comisiones o Usos horarios no necesitan 32 filas y con esta densidad se ven apretadas. Merecerían un modo «cómodo» (fila de 34 px) que esta propuesta no trae.
4. **Trabajo real de migración.** Los 2.179 `text-white/XX` y los 720 `#FF6600` literales no se convierten solos, y los cinco `shared.ts` habría que centralizarlos **conservando los nombres** (`primaryButton`, `ghostButton`, `fieldInput`, `TH`, `TH_STICKY_LEFT`, `tableShell`, `STICKY_BG`, `cellShell`, `warnBox`…) o son 3.000 líneas de cambios en cinco módulos.
5. **Menos impacto en la primera impresión.** Esto no luce en una captura para enseñar a un cliente. Está hecho para la hora tres, no para el segundo cinco. Si el ERP también se usa para vender, esta dirección no ayuda ahí.
6. **Hay que arreglar la configuración de Tailwind.** Esta propuesta no usa `rounded-lg` porque en este repo son 24 px y no 8; si se adopta, la escala de radios del `tailwind.config.ts` hay que corregirla, y eso mueve las esquinas de los 242 sitios que hoy están mal sin saberlo.

---

## 11. Qué se conserva de lo de hoy

Estas cosas están bien resueltas y hay razones escritas para cada una. Tirarlas por reescribir el CSS sería el peor resultado posible.

- **`tabular-nums` en todo número** (177 usos hoy). Sin eso no se compara celda a celda contra el Excel del cliente, que es exactamente lo que se hace en «Probar».
- **La cadena de tres `min-w-0`** que mantiene el scroll horizontal dentro de la caja de la tabla. Comprobado en navegador: tabla de 1.728 px dentro de una caja de 1.200, y la página no se mueve de lado ni se lleva la barra lateral por delante.
- **El fondo opaco de la columna congelada** y el escalonado de z-index: esquina 30 · cabecera 20 · primera columna 10 · resto 0.
- **«Ver más (N restantes)»** en vez de virtualizar, para que Ctrl+F, el scroll y la impresión se comporten igual en todas las tablas del ERP. Y va **dentro** del scroll, así que no cuesta ni un píxel de cromo permanente.
- **La celda que no parece un campo hasta que pasas por encima**: es lo único que impide que doce columnas editables se lean como un formulario.
- **Guardado al salir del campo, sin botón** — ahora con la confirmación que le faltaba.
- **El estado siempre con palabra en castellano**, y las pistas (*«No coge, buzón o cuelga: hay que reintentar»*).
- **`simulacro` en gris y no en verde**, y la lista explícita de frenos apagados.
- **Formato español** en fechas e importes.

---

## 12. Los ficheros

| fichero | qué es |
|---|---|
| `estilos.ts` | La hoja de estilo entera, con prefijo `dz-` y los dos temas. Se inyecta en un `<style>` desde `Marco.tsx`. |
| `datos.ts` | El contenido de las maquetas: estados, módulos, leads, frenos, columnas, historial. |
| `Marco.tsx` | Barra lateral, barra superior y las piezas de estado (`Estado`, `Pildora`). |
| `PantallaInicio.tsx` | Pantalla 1 — `/dashboard`. |
| `PantallaColdCalling.tsx` | Pantalla 2 — `/dashboard/cold-calling`, vista tabla. |
| `PantallaPerfil.tsx` | Pantalla 3 — `/dashboard/amazon-api` → perfil de lectura de stock. |
| `DisenoDenso.tsx` | El conmutador con el regulador de tema y de altura de ventana. |
| `memoria.ts` | Esta misma memoria, en datos, para que la app de comparación la pinte sin teclearla otra vez. |
| `index.ts` | El punto de entrada. |

**No se ha tocado nada fuera de esta carpeta.** Ni `app/globals.css`, ni el layout, ni ningún componente del ERP.

---

## Apéndice · Dos errores que encontró la medición

Se dejan aquí porque son la razón de dos decisiones del CSS que si no parecen manía:

1. **`.dz-t3` perdía contra `.dz-tabla tbody td`.** Especificidad (0,1,0) contra (0,1,2): una celda de contexto marcada como nivel 3 se pintaba del nivel 2. Por eso las utilidades de texto van prefijadas con `.dz-raiz`. Con cuatro niveles y no dieciséis, que cada uno sea el que dice ser es justo lo que hay que garantizar.
2. **`.dz-raiz button { color: inherit }` ganaba a todos los componentes de botón.** (0,2,1) contra (0,1,0): chips, ítems de menú y botones de icono salían pintados del nivel del contenedor. Los ratios seguían pasando —salían más claros, no más oscuros— pero **la jerarquía se aplanaba sola**, que es exactamente el defecto que esta propuesta viene a arreglar. Se resuelve con `:where()`, que no suma especificidad.

Los dos se vieron leyendo `getComputedStyle` en el navegador, no leyendo el CSS. Es el mismo método que hay que aplicar a la migración: medir el píxel, no confiar en la clase.
