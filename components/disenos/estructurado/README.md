# Propuesta «ESTRUCTURADA POR CONTEXTO»

> **La idea, en una frase.** El cliente deja de ser un filtro dentro de cada módulo y
> pasa a ser el contexto del ERP: se elige una cuenta arriba, se queda a la vista, y las
> herramientas se reorganizan alrededor — con «lo mío» y «la agencia» en un espacio
> aparte que nunca se mezcla con el trabajo de cliente.

```tsx
import PropuestaEstructurada from '@/components/disenos/estructurado'
<PropuestaEstructurada />
```

Se monta sola. No toca `app/globals.css`, ni el layout, ni ningún componente existente.
Todo su CSS vive dentro de un `.ctx-root` con `data-ctx-tema`, así que convive con el ERP
tal cual está y con las otras dos propuestas.

---

## 1. El problema que resuelve, que no es el color

El ERP tiene **dos naturalezas mezcladas en el mismo cajón**: herramientas internas
(horas, vacaciones, tesorería, empleados) y trabajo sobre **dieciséis cuentas de Amazon**
(catálogo, precios, stock, campañas). Hoy la navegación las trata igual: una lista plana de
18 módulos ordenados por el día en que se escribieron.

Tres consecuencias medibles:

1. **No se sabe sobre qué cuenta se trabaja.** No aparece en ninguna pantalla salvo el
   botón encendido de una tira de 16 clientes topada a `lg:max-h-[128px]` que scrollea
   dentro de sí misma. Para elegir cliente hay que scrollear dentro de una franja que
   ocupa el 24 % del cromo de la pantalla.
2. **Cambiar de cuenta es volver atrás y entrar por otro lado.** Del catálogo de Creative
   Toys al de Shoplamp: volver, buscar el botón, pulsarlo, volver a filtrar.
3. **Lo interno y lo de cliente se estorban.** «Mis vacaciones» y «Amazon API» están al
   mismo nivel en el menú y no tienen nada que ver.

La respuesta es **navegación en dos niveles con la cuenta como contexto persistente**.

### El armazón

```
┌──────────────────────────────────────────────────────────────────────────┐
│ LS │ [SL] Shoplamp        │ / Mis clientes / Perfiles   [Buscar ⌘K] …    │  48 px
│    │      Amazon ES       │                                              │
├────┼──────────────────────┴──────────────────────────────────────────────┤
│Mío │ Mis clientes                                                        │
│    │ ─────────────────────                                               │
│Cli │ │ [SL] Shoplamp      │   ← la cuenta, otra vez, con su estado      │
│ent │ │ Amazon ES · 480 SKU│                                              │
│    │ │ ✓ Conectada        │            EL TRABAJO                        │
│Age │ │ ▲ Frenado 06:20    │                                              │
│ncia│ ─────────────────────                                               │
│    │ LA CUENTA                                                           │
│    │  Resumen de la cuenta                                               │
│    │  Catálogo y precios                                                 │
│    │  Amazon Ads                                                         │
│    │ AUTOMATIZACIÓN                                                      │
│    │  Sincronismo de stock                                               │
│    │ ▌Perfiles de lectura      ← el filo naranja: «dónde estoy»          │
│    │  Cambios enviados    (14) ← el contador naranja: «qué hacer»        │
└────┴─────────────────────────────────────────────────────────────────────┘
 60px          232 px
```

**Nivel 1 — tres espacios** (carril de 60 px de ancho, 144 px de alto, siempre visibles):

| Espacio | Qué es | Módulos |
|---|---|---|
| **Mi trabajo** | Habla de una persona | Mi día · Agenda Comercial · Mis Horas · Mis vacaciones |
| **Mis clientes** | Habla de **una** cuenta de Amazon | Resumen · Catálogo y precios · Amazon Ads · Sincronismo de stock · Perfiles de lectura · Cambios enviados · Conexión |
| **Agencia** | Habla de la empresa | CRM Leads Web · LinkedIn · Cold Calling · Comisiones · Comisiones Shoes F · Tesorería · Control empleados · Employee Tracker · Gestión de Usuarios · Teléfonos · Usos horarios |

**Nivel 2** enseña solo los módulos del espacio en el que estás: **once como mucho**.
Hoy son dieciocho en una lista de 1.049 px que, por debajo de esa altura de ventana,
scrollea sola (a 780 px se ven 11 de 18).

**El selector de cuenta** es permanente y está siempre en el mismo sitio. Y hace una cosa
que es media propuesta: **cuando el espacio no es de cliente, se apaga a la vista** — gris,
sin naranja, con la palabra «Sin cuenta · Herramientas internas». Es la forma más barata
de decir «esto no es de ningún cliente, no te confundas».

**Cambiar de cuenta no te saca de donde estás.** Si estabas en el catálogo, sigues en el
catálogo, con otro cliente. Un clic, desde cualquier pantalla.

**Y la cuenta se repite en la navegación**, con su estado de conexión y su última lectura
de stock. Es redundante a propósito: el error que se quiere hacer imposible es teclear un
precio creyendo que estás en otra tienda.

---

## 2. Cumplimiento: qué NO puede hacer la vista de varias cuentas

> Lo firmado ante Amazon **prohíbe agregar o comparar datos entre clientes**. Una vista de
> varias cuentas puede enseñar cada una por separado, nunca medias ni comparativas.

La lista de las 16 cuentas de la portada está construida contra esa regla:

- **Sin fila de totales, sin medias, sin «top», sin gráficas agregadas.**
- **No se puede ordenar por ningún dato de negocio del cliente**: ni facturación, ni
  unidades, ni ACOS. Solo por nombre y por si **nosotros** tenemos algo pendiente ahí.
- Lo que se enseña por cuenta es **el estado de nuestros procesos** —¿se envió el stock?,
  ¿hay cambios sin mandar?, ¿está revisada la semana de campañas?—, no el rendimiento del
  cliente. Es trabajo nuestro, no negocio suyo.
- La lista **no lleva columna de SKU**. La llevó, y era la única casilla que se saltaba
  esta misma regla: el tamaño del catálogo no es estado de un proceso nuestro, es dato de
  catálogo de Amazon del cliente, y dieciséis de ellos en una columna alineada a la derecha
  se comparan de un vistazo aunque no se pueda ordenar. El dato no se pierde: está en la
  **tarjeta de contexto de la cuenta activa**, donde se ve una sola y donde sí significa
  «el tamaño del catálogo que vas a abrir».
- **La regla está escrita en la pantalla**, junto a la cabecera de la lista: *«Sin totales
  ni comparativas entre cuentas»*. No solo en un comentario del código. El día que alguien
  pida «una columnita de facturación aquí» hay que poder señalar dónde pone que no.

**Riesgo residual, dicho claro:** poner las 16 cuentas en una misma lista es, por su forma,
una invitación a compararlas. El diseño lo desactiva quitando lo comparable, pero la
tentación no desaparece. Esta pantalla necesita un dueño que diga que no.

---

## 3. La escala tipográfica

Hoy hay **28 tamaños en dos sistemas paralelos** (`text-sm`/`text-xs` en los módulos
viejos, `text-[11px]`/`text-[10px]` en los nuevos; la frontera es cronológica, no
semántica) y **seis grosores** descargados, de los cuales dos no se usan nunca.

**Cinco tamaños. Tres grosores. Cero pesos sin usar.**

| Nivel | px / interlineado | Grosor | Para qué |
|---|---|---|---|
| `ctx-xl` | 19 / 26 | 600 | El contexto: el nombre de la cuenta. **Uno por pantalla.** |
| `ctx-lg` | 15 / 22 | 600 | Título de panel o de sección. Lo que agrupa. |
| `ctx-md` | 13 / 18 | 400 | **El nivel de trabajo:** celda de tabla, valor de campo, cuerpo. El 80 % del texto. |
| `ctx-sm` | 12 / 16 | 400 | La nota que explica un campo, el dato de apoyo. |
| `ctx-xs` | 11 / 14 | 600 | Etiqueta de campo y cabecera de columna. |

Mínimo absoluto: **11 px**. Hoy hay 25 usos de 9 px y 5 de 8 px. El interlineado es
explícito en los cinco niveles; hoy el 96 % del texto hereda 1,5, incluidas las celdas de
10 px.

---

## 4. La paleta

**Tres niveles de texto, no dieciséis.** Y un cuarto tono que **no lleva información
nunca**: solo el guion de «sin dato» y el borde de los campos.

| Rol | Claro | Oscuro | Para qué |
|---|---|---|---|
| Fondo de página | `#EFF1F4` | `#0E1014` | El suelo. Nunca lleva texto. |
| Superficie | `#FFFFFF` | `#15181D` | Paneles y tablas. Donde vive el dato. |
| Superficie 2 | `#F5F6F8` | `#1B1F26` | Cebra de la tabla y cabecera de columna. |
| Superficie 3 | `#E7EAEE` | `#0A0C0F` | Hundido: el carril y la fila bajo el ratón. |
| Filete | `#DDE1E6` | `#262B33` | Separador de fila y de celda. |
| Filete estructural | `#C4CAD2` | `#363D47` | Contorno de panel. **Sustituye al `backdrop-filter`.** |
| **Texto 1** | `#15181D` | `#EDEFF2` | **El dato.** Lo que se lee. |
| **Texto 2** | `#4B535E` | `#A5AEBA` | Etiqueta y cabecera de columna. Lo que orienta. |
| **Texto 3** | `#5E6774` | `#8A94A1` | La nota que explica. Lo que se lee una vez. |
| Apagado (no texto) | `#7E8794` | `#727C8A` | El borde de los campos y el guion de «sin dato». **Nunca lleva una palabra encima:** está medido contra 3:1. |
| Naranja de relleno | `#FF6600` | `#FF6600` | El de marca, sin tocar, **siempre con etiqueta oscura** `#1A1206`. |
| Naranja de texto | `#B34700` | `#FF8B45` | Cuando el naranja tiene que ser texto o icono fino. Mismo tono, otra luz. |
| Correcto | `#10703C` | `#5DDC98` | Enviado, conectado, cita cualificada. Siempre con ✓. |
| Aviso | `#8A5A00` | `#F2C14E` | Frenado, caducado, freno apagado. Siempre con ▲. |
| Error | `#B3261E` | `#FF8A80` | Error de lectura, conexión revocada. Siempre con ✕. |
| Neutro | `#4B535E` | `#A5AEBA` | Sin cambios, simulacro, sin perfil. **Nunca verde.** |

### El naranja vuelve a significar algo

Hoy hay **720 apariciones literales de `#FF6600`** y no hay un solo módulo sin él. Un
acento que sale 720 veces no acentúa nada.

Aquí el naranja significa **dos cosas: dónde estoy y qué tengo que hacer.**

**SÍ:**
- El selector de cuenta cuando hay una cuenta activa (filo, fondo tenue, sigla).
- El filo de 3 px del espacio activo en el carril y del módulo activo en la navegación.
- **El botón de acción principal. Uno por pantalla, y ninguno más.**
- Los contadores que piden acción: 7 leads sin leer, 14 cambios sin enviar, 14 rellamadas.
- El asterisco de campo obligatorio y el anillo de foco del teclado.

**NO:**
- Los iconos de la portada. Hoy son **18 iconos naranjas idénticos**: la prueba más clara
  de que el acento dejó de significar algo.
- El chip de filtro encendido. **Un filtro no es un sitio**: se enciende invirtiendo el
  neutro.
- La fila seleccionada de una tabla. Hoy compite con el naranja de «En seguimiento» y con
  el del chip activo — tres naranjas distintos en la misma pantalla queriendo decir tres
  cosas.
- **El cuerpo de la tabla, entero.** Así «En seguimiento» vuelve a ser el único naranja de
  la tabla.
- Bordes, hover, enlaces, títulos, KPI, insignias de rol.

En la portada: de **18 elementos naranjas** a **3**. En Cold Calling: **4**.

---

## 5. Contraste MEDIDO

Fórmula WCAG 2.1 sobre los colores finales compuestos. Sobre la superficie de trabajo
(`#FFFFFF` en claro, `#15181D` en oscuro). Umbral: **4,5:1** — todo el texto de estas
pantallas es texto normal a efectos de WCAG.

| Par | Claro | Oscuro | Dónde |
|---|---|---|---|
| Texto 1 | **17,79** | **15,45** | El dato de la celda, el nombre de la cuenta |
| Texto 2 | **7,78** | **7,93** | Cabecera de columna y etiqueta de campo |
| Texto 3 | **5,41** | **5,79** | La nota que explica cada campo |
| Texto 1 sobre cebra | **16,45** | **14,35** | Filas pares |
| Texto 2 sobre cebra | **7,20** | **7,37** | Cabecera de columna |
| Texto 3 sobre cebra | **5,00** | **5,38** | Dato secundario en fila par |
| Apagado *(no texto, umbral 3:1)* | **3,63** | **4,21** | Guion de «sin dato», borde de campo |
| Naranja de texto | **5,50** | **7,65** | Contadores, asterisco, anillo de foco |
| **Etiqueta oscura sobre botón naranja** | **6,31** | **6,31** | **El botón principal** |
| Correcto | **6,17** | **10,30** | Enviado, conectada, cita cualificada |
| Aviso | **5,93** | **10,60** | Frenado, caducada, freno apagado |
| Error | **6,54** | **7,79** | Error de lectura, conexión revocada |
| Correcto sobre su tinte | **5,38** | **9,15** | Caja de confirmación |
| Aviso sobre su tinte | **5,23** | **9,46** | Caja de «hay frenos apagados» |
| Error sobre su tinte | **5,58** | **7,52** | Caja de error |

**El peor par de texto de toda la propuesta es 4,74:1**: Texto 3 sobre el hundido
(`surface3`) en claro, que es la fila seleccionada de una tabla y el carril de espacios.

Antes aquí ponía 4,78 —Texto 3 sobre el *fondo de página*—, y no era el peor: era un par
más suave y encima uno donde casi no va texto. El peor de verdad daba **4,48** y suspendía.
Se arregló bajando la luz de Texto 3 en claro de `#616B78` a `#5E6774`, mismo tono. Es la
diferencia entre decir «los tres niveles pasan 4,5:1» y que sea cierto.

### Los siete estados de Cold Calling

Los tonos del Excel **se conservan** —el equipo se los sabe y reaprenderlos cuesta dinero—
pero se les mueve la luz para que se lean también en claro. El tono es el mismo: sigue
siendo «el amarillo», «el cian», «el magenta».

| Estado | Claro | ratio | Oscuro | ratio |
|---|---|---|---|---|
| Sin contactar | `#5E6774` | 5,72 | `#8A94A1` | 5,79 |
| No contesta | `#8A6300` | 5,43 | `#EAB308` | 9,28 |
| Rellamada programada | `#0B6F82` | 5,82 | `#22C8E4` | 8,85 |
| Info enviada | `#9A28AE` | 6,39 | `#E86BF7` | 6,67 |
| En seguimiento | `#A84F09` | 5,54 | `#FB8C3C` | 7,56 |
| Cita cualificada | `#157A3B` | 5,41 | `#3ADD79` | 10,00 |
| No le interesa | `#B51E18` | 6,64 | `#FF6B6B` | 6,41 |

Con los hues originales sobre blanco: amarillo `#EAB308` → **1,92:1**, verde `#22C55E` →
**2,28:1**, cian `#06B6D4` → **2,43:1**. Como marca de 3 px sobre fondo claro, tres de los
siete eran invisibles.

### Lo que se arregla

| Par de hoy | Usos | Claro | Oscuro | Dónde duele |
|---|---|---|---|---|
| `text-white/40` | 251 | 4,05 ✗ | 3,80 ✗ | **La cabecera de todas las tablas del ERP**, a 10 px |
| `text-white/35` | 129 | 4,05 ✗ | 3,17 ✗ | Las ~50 etiquetas y notas de la pantalla de perfiles |
| `text-white/30` | 142 | 2,44 ✗ | 2,63 ✗ | El precio de un listing FBA que no se puede editar |
| `text-white/25` | 95 | 2,44 ✗ | 2,18 ✗ | Marcadores de posición |
| `text-white/20` | 63 | 2,44 ✗ | 1,80 ✗ | El guion de «no hay dato» |
| blanco sobre `#FF6600` | 192 | 2,94 ✗ | 2,94 ✗ | **El botón principal del ERP, en los dos temas** |
| `#FF6600` sobre su píldora, claro | — | 2,43 ✗ | — | **El ítem activo del menú: en claro no se lee dónde estás** |
| `glass-card` en claro | 188 | 1,09 ✗ | — | Blanco sobre blanco: 188 tarjetas sin borde ni superficie |

**Hoy fallan 682 usos en oscuro (31 %) y 804 en claro (37 %). Aquí fallan 0.**

---

## 6. Densidad: cuántas filas caben

Presupuesto de píxeles de la propuesta, pieza por pieza:

```
barra superior          48
padding del contenido   24  (12 arriba + 12 abajo)
tira de cifras          30  (sustituye a cuatro tarjetas de 57,5 px)
barra de herramientas   28  (buscador + chips de estado + orden)
pie «Ver más»           26
tres huecos de 8        24
bordes de la tabla       2
cabecera de la tabla    26
                     ─────
                       208 px
```

Contra los **396,5 px** de Cold Calling y los **525 px** del catálogo de hoy.

| Alto de ventana | Cold Calling hoy | Catálogo hoy | **Compacta 24 px** | **Normal 28 px** | **Cómoda 32 px** |
|---|---|---|---|---|---|
| 1080 (monitor a pantalla completa) | 19 | 16 | **36** | **31** | **27** |
| 940 (monitor con Chrome + barra macOS) | 15 | 12 | **30** | **26** | **22** |
| 780 (portátil 1440×900 con Chrome) | 10 | 7 | **23** | **20** | **17** |

**+12 filas en Cold Calling y +15 en el catálogo a 1080 px, en densidad normal**, sin bajar
de 13 px de texto ni de 4,5:1 de contraste. *(Comprobado en navegador contra el marcado
real: la caja de la tabla mide 898 px a 1080 y entran 31 filas de 28.)*

De dónde salen los píxeles:

- **Las cuatro tarjetas de KPI** (57,5 px + 12 de hueco) → una tira de una línea de 30 px.
  No se pierde ni un dato; se pierde el aire.
- **Las tres filas de filtros** (117 px) → una. Los siete chips de estado, que se tocan
  cada minuto, se quedan a la vista; lista de origen, rango de facturación y comercial
  —que se tocan una vez al día— se van a «Más filtros», con el número de filtros puestos
  siempre visible al lado.
- **El título de pantalla de 36 px** (76–79 px con su subtítulo y su margen) desaparece de
  **todas** las pantallas: ya está en las migas de la barra superior, y allí además dice de
  qué espacio cuelga. La barra de 48 px se paga una vez y sale más barata.
- **La tira de 16 botones de cliente del módulo de Amazon** (140 px) desaparece entera: es
  el selector de la barra superior.
- **La celda editable ya no ensancha la fila.** Hoy 6 de los 35,5 px de fila —el 21 %— los
  pone el cromo de la celda editable, no el dato: el borde de foco se pinta con
  `box-shadow` por dentro, así que la fila no cambia de alto al entrar en edición.

El alto de fila es **un ajuste del usuario**, no una decisión cerrada: Daniella quiere ver
catálogo y los comerciales quieren ver cartera, pero Marius entra dos veces al día y
prefiere leer.

---

## 7. Modo principal: **CLARO**

Y el oscuro **no es una traducción**: está diseñado con sus propios valores y medido
aparte. Se cambia con un botón en la barra superior.

Por qué claro:

1. **Se trabaja con luz de oficina, sobre texto pequeño, ocho horas.** Con luz ambiente
   normal, el texto oscuro sobre fondo claro se lee mejor y cansa menos: la pupila se
   cierra, la profundidad de campo crece y el desenfoque de los bordes de letra baja. Es la
   diferencia entre la hora primera y la hora séptima.
2. **El claro es hoy el caso difícil y está sin resolver.** La `glass-card` no tiene
   traducción (188 tarjetas en 55 ficheros que en claro se quedan **sin borde ni
   superficie**, 1,09:1); la barra lateral tampoco (1,00:1); el naranja de marca no llega
   ni al 3:1 de texto grande; y el ítem activo del menú da 2,43:1, o sea que **en tema
   claro no se lee en qué módulo estás**. Diseñar primero el caso difícil obliga a que el
   acento y los estados funcionen. Al revés, no.
3. **El oscuro se lo lleva entero quien lo prefiera**, no una capa de 140 líneas que
   reinterpreta clases de Tailwind.

---

## 8. Los estados, sin depender del color

**Regla:** ningún estado se distingue solo por color. Cada uno es una terna —**icono +
palabra + tono**— y el tono es el que sobra. Se puede imprimir la pantalla en blanco y
negro y sigue leyéndose.

Por qué importa aquí y no es una casilla que marcar: en Cold Calling hay **siete** estados
y hoy se distinguen por un punto de 8 px y por el tinte de la fila al 8 % de alfa. Con
deuteranopía, `#EAB308` (no contesta), `#F97316` (en seguimiento) y `#22C55E` (cita
cualificada) a ese alfa **son el mismo beige** — y son tres estados que mandan tres
acciones distintas.

| Estado | Icono | Por qué ese icono |
|---|---|---|
| Sin contactar | círculo punteado | Todavía no se ha tocado |
| No contesta | flecha de reintentar | «Vuelve a llamar» |
| Rellamada programada | reloj | «Tienes hora» |
| Info enviada | sobre | «La pelota está en su tejado» |
| En seguimiento | flecha ascendente | «Hay que insistir» |
| Cita cualificada | calendario con ✓ | Cerrado |
| No le interesa | prohibido | Descartado |

Los iconos están elegidos por **lo que hay que hacer**, no por decorar.

**El tinte de fila del Excel se sustituye por un filo de 3 px en la primera celda**, con el
mismo color. Se sigue barriendo la columna con la vista sin leer nada, pero el color deja
de tener que sobrevivir a un 8 % de alfa. Y el tinte **se puede volver a encender** —botón
«Teñir filas como el Excel»— y entonces **suma** al filo y al icono, no los sustituye. Está
apagado por defecto, **no borrado**: quitarle al equipo el código de colores que traían del
Excel no es una decisión que tome un diseñador.

Lo mismo en el resto del ERP: `simulacro` sigue **en gris y con icono de espera, nunca de
visto bueno** — es una decisión de significado que ya está tomada en `lib/types/stock-sync.ts`
y que esta propuesta respeta letra por letra: es el estado de un cliente que **no está
mandando nada**.

---

## 9. Las tres pantallas

### Pantalla 1 — `Mi trabajo → Mi día` (la portada)

Hoy: 18 tarjetas de 202 px, todas iguales, todas con el mismo icono naranja de 48 px, para
tres líneas de texto. A 1080 px se ven 14 de 18; a 780, ocho.

La portada **deja de ser un menú** —para eso está el carril, que ya está siempre a la
vista— y pasa a ser **un parte**, en tres bloques y en este orden:

1. **Mi día.** Lo mío: horas de hoy y de la semana, vacaciones disponibles, lo que tengo
   hoy. Es lo único que se agrega libremente, porque son mis horas y mis citas.
2. **Mis clientes.** Las dieciséis, una línea de 30 px cada una, con conexión, estado del
   stock de hoy y qué trabajo nuestro queda pendiente. **Es lo que hoy no existe en ninguna
   pantalla del ERP.**
3. **Todo lo demás.** Lo mío y lo de la agencia, una línea por módulo, en columnas.

**31 destinos visibles sin scroll a 1080 px** (16 cuentas + 15 accesos), en el alto que hoy
ocupan 14 tarjetas de las 18.

### Pantalla 2 — `Agencia → Cold Calling`, vista tabla (la tabla larga)

Doce columnas, seis editables en línea, siete estados, casi 4.000 filas. Ver §6 y §8.

Dos cosas que se conservan porque están bien:
- **La celda editable no parece un campo hasta que pasas por encima.** Es lo único que
  impide que una tabla de doce columnas editables se lea como un formulario.
- **`tabular-nums` en importes, teléfonos y fechas.** Sin eso no se puede comparar celda a
  celda contra el Excel del cliente, que es exactamente lo que se hace.

### Pantalla 3 — `Mis clientes → Perfiles de lectura` (el formulario denso)

~50 campos y la peor legibilidad del ERP: etiquetas y notas a `text-white/35` (3,17:1 en
oscuro), a 10 px. Es decir: **el texto que hace la pantalla usable es el que peor se lee**.

Cuatro cambios, y ninguno es de color:

1. **La etiqueta y la nota suben de nivel.** Etiqueta a 11 px 600 sobre Texto 2
   (7,78 / 7,93) y nota a 12 px sobre Texto 3 (5,41 / 5,79). No es que ahora «pasen»: es
   que pasan con margen, que es lo que hace falta a la hora séptima.
2. **Un freno apagado lo dice.** Hoy la diferencia entre «este freno está puesto en el 30 %»
   y «este freno está apagado» es un marcador de posición gris dentro de una casilla vacía.
   Aquí cada freno tiene **interruptor explícito** y, apagado, la fila entera se recuadra en
   ámbar con su triángulo y la palabra **APAGADO**. Un freno apagado no es una casilla sin
   rellenar: es un cliente sin protección.
3. **Hay confirmación de guardado.** El patrón de «sin botón de guardar» se conserva —es
   correcto: un formulario de cincuenta campos con un botón al final es un formulario que se
   pierde entero cuando alguien cierra la pestaña a medias— pero se le añade lo que le
   faltaba: **«Guardado 09:14» por campo** y una franja de **últimos cambios con deshacer**,
   con el valor anterior tachado al lado del nuevo. Guardar sin decirlo es, desde el lado de
   quien teclea, lo mismo que no guardar.
4. **Índice a la izquierda.** Cincuenta campos en una columna son cinco pantallas de
   scroll; con el índice se ve la forma entera del perfil y se salta a «Frenos» sin
   buscarlo. Y el índice avisa: si hay frenos apagados, lleva su triángulo.

A la derecha, en columna fija: **qué entiende el perfil con el fichero de hoy** (hoja, fila
de cabecera, qué columna real se ha llevado cada campo, las primeras filas interpretadas) y
**las últimas ejecuciones** con sus cinco estados.

---

## 10. Qué gano y qué pierdo

### Gano

- Se sabe **siempre** sobre qué cuenta se trabaja.
- **Cambiar de cuenta es un clic** y no te mueve de pantalla.
- **+12 filas** en Cold Calling y **+15** en el catálogo, a 1080 px.
- **Tres niveles de texto** en vez de dieciséis, todos por encima de 4,5:1 en los dos temas.
- **El botón principal se puede leer**: 6,31:1 frente a 2,94:1. Y sigue siendo naranja.
- Los siete estados **se leen en blanco y negro**.
- **Un freno apagado lo dice**, con interruptor, icono y palabra.
- **Los cambios se confirman**, conservando el guardado al salir del campo.
- **El tema claro es un tema**, no una capa de traducción de clases.
- Se van 188 `backdrop-filter`, la animación infinita de 25 s del fondo, el `blur(10px)` de
  500 ms de cada navegación y las transiciones sobre `*`. En la portada hoy hay **20 capas
  de desenfoque simultáneas**.

### Pierdo — y esto hay que leerlo entero

- **Es la propuesta más cara de las tres.** No es un cambio de CSS: mueve el armazón, el
  menú y el modelo mental. Sin el plan por pasos de abajo, no se adopta.
- **Se pierde el tinte de fila del Excel como estado por defecto.** Está devuelto detrás de
  un botón, pero de salida la tabla ya no se ve como el Excel del que vienen, y **el primer
  día eso molesta**.
- **Los filtros de lista, facturación y comercial se van a un desplegable.** Se ganan 89 px
  de alto y se pierde un clic cada vez. Es la apuesta a que se tocan una vez al día; si
  resulta que no, hay que devolverlos a la vista.
- **Se pierde el glass.** El desenfoque y la translucidez son lo que hoy hace que el ERP
  parezca caro en una captura. Esta propuesta es deliberadamente plana: **gana el que
  trabaja ocho horas y pierde la primera impresión.**
- **Lo interno y lo de cliente quedan en sitios distintos**, y hay gente que hoy los usa
  seguidos. Un comercial que salta de Cold Calling a la Agenda cruza dos espacios; hoy están
  a un ítem de distancia en la misma lista.
- **Decidir de qué espacio cuelga cada módulo obliga a decisiones que hoy nadie ha
  tomado.** Tesorería enseña ingresos por cliente: está en Agencia, pero alguien pedirá
  verla dentro de la cuenta. Marketing es de cliente pero la revisión semanal es de agencia.
  **Habrá que arbitrar, y es una conversación, no un commit.**
- **La barra superior de 48 px es alto fijo que antes no existía.** Se paga con creces
  —quita 76–79 px de título por pantalla— pero ninguna pantalla podrá recuperar esos 48.
- **Tres niveles de texto obligan a decidir**, en cada uno de los ~4.000 sitios donde hoy
  hay un `text-white/XX`, cuál de los tres es. No lo puede hacer un *find-and-replace*.
- **El alto de fila configurable es una preferencia más que mantener**, y significa que dos
  personas del equipo ven pantallas distintas: al describir un problema por teléfono, «la
  fila de abajo del todo» deja de significar lo mismo.

---

## 11. Cómo se llega ahí, por pasos

El riesgo de esta propuesta es proponer una reestructuración tan grande que no se adopte.
**Ninguna ruta del ERP cambia de sitio en ninguno de los cinco pasos.** Cada `ruta` de
`navegacion.ts` es una ruta que ya existe.

| Paso | Qué se hace | Coste | Qué se nota |
|---|---|---|---|
| **1. La barra superior sobre el ERP de hoy** | Se añade la barra de 48 px con el selector de cuenta y las migas. Nada más. El selector escribe el cliente elegido en un contexto de React y en `localStorage`; los tres módulos que ya tienen tira de clientes (Amazon API, stock-sync, marketing) leen de ahí en vez de su estado local. | Un componente nuevo y tres líneas en cada uno de esos tres módulos. | **Se sabe sobre qué cuenta trabajas, y cambiar de cuenta deja de sacarte de la pantalla. Es el 70 % del valor de la propuesta.** |
| **2. Los dos niveles de menú** | La barra lateral se parte en carril + lista del espacio. Solo cambia `lib/config/apps.ts`, que pasa de una lista plana a tres listas con grupo. | Un fichero de configuración y `AppSidebar.tsx`. | De 18 ítems en 1.049 px a 11 como mucho. Y queda dicho qué es de cliente y qué no. |
| **3. Los tokens, centralizados** | Los cinco `shared.ts` pasan a uno solo **conservando los nombres**: `primaryButton`, `ghostButton`, `fieldInput`, `cardShell`, `warnBox`, `TH`, `tableShell`, `STICKY_BG`, `cellShell`… Cambia el valor, no el nombre. | Un fichero nuevo y cinco reemplazos de `import`. | Todo el ERP cambia de aspecto de golpe sin tocar 3.000 líneas. Aquí se arreglan la cabecera de tabla a 3,80:1 y el botón blanco sobre naranja. |
| **4. Densidad y estados, tabla a tabla** | Alto de fila configurable y el patrón icono + palabra, empezando por Cold Calling y el catálogo. | Dos componentes de tabla. | +12 filas por pantalla y estados legibles en blanco y negro. |
| **5. La portada y la retirada del glass** | Se rehace `/dashboard` como parte y se quitan `glass-card`, el fondo animado y las transiciones sobre `*`. | 55 ficheros usan `glass-card`, pero casi todos son la misma tarjeta. | El tema claro deja de tener 188 tarjetas invisibles. |

**Si solo se hiciera el paso 1, ya habría valido la pena.**

---

## 12. Qué se conserva del ERP de hoy

Esto está bien resuelto y hay razones escritas para cada cosa. Tirarlo sería el peor
resultado del ejercicio:

- `tabular-nums` en todo número (177 usos).
- La cadena de tres `min-w-0` que mantiene el scroll horizontal dentro de la caja.
- El **fondo opaco** en las celdas congeladas, y por variable, no por hex en línea.
- La escalera de `z-index`: **esquina 30 · cabecera 20 · primera columna 10 · resto 0**.
- Paginación incremental con **«Ver más (N restantes)»** en vez de virtualización, para que
  Ctrl+F, el scroll y la impresión se comporten igual en todas las tablas.
- **La celda que no parece un campo hasta el hover.**
- **Sin botón de guardar**, guardando al salir del campo, con el valor anterior a la vista y
  deshacer por celda.
- Los estados **siempre con palabra, en español**, y sus `HINTS`.
- **Los colores del Excel**, con la luz ajustada y nunca como único portador.
- **`simulacro` en gris**, y la lista explícita de frenos apagados.
- Filtros recordados por usuario con **«Limpiar filtros» siempre visible**.
- Formato español en todo: `toLocaleString('es-ES')`, `APP_TIMEZONE`, «hace 4 minutos».
- **Los nombres de los tokens de los cinco `shared.ts`.** El equipo los usa; cambiarlos son
  3.000 líneas de cambios en cinco módulos.

---

## 13. Ficheros

| Fichero | Qué es |
|---|---|
| `tokens.ts` | Colores, tipografía, densidad, radios. Con los ratios medidos anotados. |
| `estilos.ts` | La hoja de estilos entera, encerrada en `.ctx-root`. Cero CSS global. |
| `navegacion.ts` | **La propuesta estructural**: tres espacios y 21 entradas sobre las rutas de hoy. |
| `metricas.ts` | El presupuesto de píxeles y el cálculo de filas por pantalla. |
| `datos.ts` | Contenido real: 16 cuentas, 32 leads, el perfil de Shoplamp. |
| `piezas.tsx` | Insignias de estado, chips, cajas, interruptor. Aquí vive la regla de «sin color». |
| `Armazon.tsx` | Barra superior, selector de cuenta, carril y navegación. |
| `PantallaInicio.tsx` | Pantalla 1. |
| `PantallaColdCalling.tsx` | Pantalla 2. |
| `PantallaPerfil.tsx` | Pantalla 3. |
| `PropuestaEstructurada.tsx` | El punto de entrada. |
| `MEMORIA.ts` | Todo esto, tipado, para pintarlo dentro del ERP. |

### Nota técnica

El CSS va como **cadena dentro de un `<style>`**, no como fichero ni como utilidades de
Tailwind, y es a propósito: `app/globals.css` tiene una capa que **reinterpreta** las clases
de Tailwind bajo `html.light` (un `text-white/70` deja de ser blanco al 70 % y pasa a ser un
gris concreto). Si esta propuesta usara utilidades de color de Tailwind, el tema claro del
ERP le cambiaría los colores por debajo y no se podría juzgar lo que se está proponiendo.

Por lo mismo se apagan aquí dentro las transiciones globales: `globals.css` declara
`* { transition-property: … transform, filter, backdrop-filter; 200ms }` más
`a { transition: all .3s }` más `button { transition: all .3s }`. En una tabla de 400 filas
eso son 400 filas animando. La regla `.ctx-root *` tiene más especificidad que `*`, `a` y
`button`, así que gana sin un solo `!important`.
