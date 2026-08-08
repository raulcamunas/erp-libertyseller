/**
 * La memoria de la propuesta «Denso y sobrio», en datos.
 *
 * Está aquí y no solo en el README para que la app de comparación pueda pintar
 * la misma ficha para las tres propuestas sin volver a teclear nada.
 *
 * TODOS LOS RATIOS DE ESTE FICHERO ESTÁN MEDIDOS EN NAVEGADOR, sobre el
 * marcado real de estos componentes y con la hoja de estilo de estilos.ts, no
 * calculados sobre el color nominal. Las alturas de fila y el recuento de filas
 * también: se leyó `clientHeight` de la caja de la tabla y se dividió entre la
 * altura de fila que devuelve `getBoundingClientRect`.
 */

export const IDEA =
  'Una herramienta de trabajo, no un escaparate: fila de 28 px, cuatro niveles de texto ' +
  'todos por encima de 4,5:1, y el naranja reservado para lo que espera una acción tuya.'

export const MODO_PRINCIPAL = 'oscuro'

export const POR_QUE_OSCURO = [
  'Es el que el equipo lleva usando desde el principio: cambiar de estética y de polaridad el mismo día son dos cambios, y solo uno de los dos es el que ha pedido nadie.',
  'Las jornadas de cold calling empiezan a las 07:00 hora de México y terminan de noche; el oscuro es más cómodo en sala con poca luz, que es donde se hacen la mitad de esas horas.',
  'Pero el claro NO es una traducción: son otros veinte valores elegidos uno a uno. Hoy el ERP tiene una capa que reinterpreta clases (`html.light .text-white\\/70 { … }`) y por eso `glass-card` acaba siendo blanco puro sobre #F5F5F7 —1,09:1— y la barra lateral se queda sin fondo. Aquí los dos temas son el mismo diseño con dos paletas, y el claro cumple los mismos umbrales.',
]

/* ------------------------------------------------------------------ */
/* Tipografía                                                          */
/* ------------------------------------------------------------------ */

export const TIPOGRAFIA = {
  fuente: 'Inter (la que ya carga el ERP; no se añade ninguna)',
  tamanos: [
    { clase: 'dz-xl', px: 15, grosor: 600, para: 'Título de pantalla y de sección grande. Uno por vista.' },
    { clase: 'dz-l', px: 13, grosor: 600, para: 'Cabecera de panel, nombre de módulo, dato destacado.' },
    { clase: 'dz-m', px: 12.5, grosor: 400, para: 'EL TEXTO DE TRABAJO: celdas de tabla, valores, campos.' },
    { clase: 'dz-s', px: 11.5, grosor: 400, para: 'Contexto: notas al pie de campo, descripciones, subtítulos.' },
    { clase: 'dz-xs', px: 11, grosor: 600, para: 'Rótulos: cabecera de columna, etiqueta de campo, unidades.' },
  ],
  grosores: [400, 500, 600],
  interlineado: {
    tabla: '18 px fijos dentro de una fila de 28',
    texto: '1,45',
    notas: '1,5',
  },
  mayusculas: 'NINGUNA. Hoy hay 236 `uppercase` casi siempre con `tracking-wider` a 10 px: es la forma más lenta de leer una palabra, y encima es el texto de menos contraste del ERP.',
  antes: '28 tamaños distintos en dos sistemas paralelos (`text-sm`/`text-xs` en los módulos viejos, `text-[11px]`/`text-[10px]` en los nuevos) y 6 pesos cargados de los que 2 no se usan nunca.',
  despues: '5 tamaños, 3 grosores.',
}

/* ------------------------------------------------------------------ */
/* Paleta                                                              */
/* ------------------------------------------------------------------ */

export const PALETA = {
  oscuro: {
    superficies: [
      { token: '--dz-fondo', hex: '#0F1114', para: 'La página. Neutro frío, nunca negro puro.' },
      { token: '--dz-sup', hex: '#15171B', para: 'Tabla, tarjeta, panel.' },
      { token: '--dz-sup2', hex: '#1A1D22', para: 'Elevación: cabecera de tabla, columna congelada, barra lateral.' },
      { token: '--dz-hover', hex: '#1F232A', para: 'La fila bajo el ratón.' },
      { token: '--dz-sel', hex: '#2A1F14', para: 'La fila en la que estás.' },
      { token: '--dz-linea', hex: '#262A31', para: 'El separador de siempre.' },
      { token: '--dz-linea2', hex: '#343941', para: 'El separador que sí tiene que verse.' },
    ],
    texto: [
      { token: '--dz-t1', hex: '#F4F5F7', para: 'El dato.' },
      { token: '--dz-t2', hex: '#CBD0D8', para: 'El dato de al lado.' },
      { token: '--dz-t3', hex: '#A2A9B4', para: 'El contexto.' },
      { token: '--dz-t4', hex: '#8A929E', para: 'El rótulo.' },
    ],
    acento: [
      { token: '--dz-acc', hex: '#FF6600', para: 'Naranja de texto y de línea.' },
      { token: '--dz-acc-relleno', hex: '#FF6600', para: 'Relleno del botón primario.' },
      { token: '--dz-acc-tinta', hex: '#14161A', para: 'Lo que se escribe encima de ese relleno.' },
    ],
  },
  claro: {
    superficies: [
      { token: '--dz-fondo', hex: '#F3F4F6', para: 'La página.' },
      { token: '--dz-sup', hex: '#FFFFFF', para: 'Tabla, tarjeta, panel.' },
      { token: '--dz-sup2', hex: '#F7F8FA', para: 'Elevación.' },
      { token: '--dz-hover', hex: '#EFF1F4', para: 'La fila bajo el ratón.' },
      { token: '--dz-sel', hex: '#FFF1E5', para: 'La fila en la que estás.' },
      { token: '--dz-linea', hex: '#E3E6EA', para: 'El separador de siempre.' },
      { token: '--dz-linea2', hex: '#CDD2D9', para: 'El separador que sí tiene que verse.' },
    ],
    texto: [
      { token: '--dz-t1', hex: '#14161A', para: 'El dato.' },
      { token: '--dz-t2', hex: '#383E48', para: 'El dato de al lado.' },
      { token: '--dz-t3', hex: '#525A67', para: 'El contexto.' },
      { token: '--dz-t4', hex: '#666D79', para: 'El rótulo.' },
    ],
    acento: [
      { token: '--dz-acc', hex: '#B84900', para: 'Naranja DE TEXTO. #FF6600 da 2,94:1 sobre blanco y 2,70:1 sobre el fondo de página claro de hoy: no pasa ni el umbral de texto grande.' },
      { token: '--dz-acc-graf', hex: '#D25400', para: 'Naranja de raíl, barra y foco (gráfico: umbral 3:1).' },
      { token: '--dz-acc-relleno', hex: '#FF6600', para: 'El naranja de marca EXACTO, sin tocar, como relleno.' },
      { token: '--dz-acc-tinta', hex: '#14161A', para: 'Encima del relleno. El blanco sobre #FF6600 da 2,94:1 y hoy es el texto de los 160 botones primarios del ERP.' },
      { token: '--dz-acc-borde', hex: '#D25400', para: 'Filo del botón primario sobre blanco, que si no el relleno no se recorta.' },
    ],
  },
}

/** Los tonos del Excel del equipo, subidos hasta pasar 4,5:1 en los dos temas */
export const ESTADOS_COLOR = [
  { nombre: 'gris — sin contactar / sin cambios / simulacro', oscuro: '#9AA2AE', claro: '#5B6270', ratioOscuro: 6.97, ratioClaro: 6.13 },
  { nombre: 'amarillo — no contesta / frenado', oscuro: '#E0B341', claro: '#7A5A00', ratioOscuro: 9.14, ratioClaro: 6.38 },
  { nombre: 'cian — rellamada programada', oscuro: '#3AC8DE', claro: '#0E6E80', ratioOscuro: 8.97, ratioClaro: 5.9 },
  { nombre: 'magenta — info enviada', oscuro: '#E879F9', claro: '#A21CAF', ratioOscuro: 7.29, ratioClaro: 6.32 },
  { nombre: 'naranja — en seguimiento', oscuro: '#FB923C', claro: '#9A4A00', ratioOscuro: 7.93, ratioClaro: 6.26 },
  { nombre: 'verde — cita cualificada / enviado', oscuro: '#4ADE80', claro: '#116B36', ratioOscuro: 10.3, ratioClaro: 6.6 },
  { nombre: 'rojo — no le interesa / error', oscuro: '#F87171', claro: '#B3261E', ratioOscuro: 6.49, ratioClaro: 6.54 },
]

/* ------------------------------------------------------------------ */
/* Contraste medido                                                    */
/* ------------------------------------------------------------------ */

export const CONTRASTE = [
  { par: 'L1 · el dato (nombre de tienda, cifra, título)', oscuro: 16.45, claro: 18.11 },
  { par: 'L2 · el dato de al lado (celda normal, campo)', oscuro: 11.58, claro: 10.76 },
  { par: 'L3 · el contexto (empresa, email, nota de campo)', oscuro: 7.58, claro: 6.96 },
  { par: 'L4 · el rótulo (cabecera de columna, sobre su fondo elevado)', oscuro: 5.38, claro: 4.91 },
  { par: 'L4 · el rótulo (etiqueta de campo, sobre superficie normal)', oscuro: 5.71, claro: 5.21 },
  { par: 'Módulo del menú lateral', oscuro: 7.14, claro: 6.55 },
  { par: 'Botón de icono de la tabla (el nivel más bajo que existe)', oscuro: 5.71, claro: 5.21 },
  { par: 'Chip de filtro apagado', oscuro: 7.58, claro: 6.96 },
  { par: 'Botón primario: tinta sobre el naranja de marca', oscuro: 6.17, claro: 6.17 },
  { par: 'L1 sobre la fila seleccionada', oscuro: 14.76, claro: 16.36 },
  { par: 'Naranja de texto sobre la superficie de tabla', oscuro: 6.11, claro: 5.26 },
]

/** El mínimo de todo lo anterior. Hoy, 31 % de los usos en oscuro y 37 % en claro caen por debajo de 4,5. */
export const CONTRASTE_MINIMO = { oscuro: 5.38, claro: 4.91 }

/* ------------------------------------------------------------------ */
/* Densidad medida                                                     */
/* ------------------------------------------------------------------ */

export const DENSIDAD = {
  alturaFila: { hoy: 35.5, ahora: 28 },
  alturaCabecera: { hoy: 27.5, ahora: 26 },
  cromo: { hoy: 396.5, ahora: 164 },
  filas: [
    { viewport: 1080, contexto: 'monitor a pantalla completa', hoy: 19, ahora: 32 },
    { viewport: 940, contexto: 'monitor 1920×1080 con Chrome', hoy: 15, ahora: 27 },
    { viewport: 780, contexto: 'portátil 1440×900 con Chrome', hoy: 10, ahora: 22 },
  ],
  barraLateral: {
    ancho: { hoy: 256, ahora: 208 },
    altoItem: { hoy: 41, ahora: 26 },
    altoTotalConLos18Modulos: { hoy: 1049, ahora: 670 },
    consecuencia:
      'La de hoy scrollea sola por debajo de 1.049 px de ventana: en un portátil se ven 11 de 18 módulos. La nueva cabe entera en cualquier pantalla del equipo.',
  },
  inicio: {
    altoPagina: { hoy: 1408, ahora: 692 },
    modulosVisiblesSinScroll: [
      { viewport: 1080, hoy: 14, ahora: 18 },
      { viewport: 940, hoy: 12, ahora: 18 },
      { viewport: 780, hoy: 8, ahora: 18 },
    ],
  },
}

/* ------------------------------------------------------------------ */
/* El acento                                                           */
/* ------------------------------------------------------------------ */

export const NARANJA = {
  regla: 'El naranja marca lo que espera una acción tuya y todavía no la ha tenido. Nada más.',
  si: [
    'La cifra que hay que atender hoy (12 rellamadas, 23 leads sin abrir).',
    'La insignia de un módulo con cosas pendientes, en la barra lateral.',
    'El raíl de 2 px del módulo en el que estás y de la fila en la que estás.',
    'El botón primario de la pantalla: uno, y con tinta oscura encima.',
    'El foco de teclado y el borde de la celda que estás editando.',
    'El asterisco de campo obligatorio.',
  ],
  no: [
    'Los iconos de los módulos (hoy, 18 iguales en la pantalla de inicio).',
    'Los títulos, los enlaces al pasar por encima y los degradados de botón.',
    'El estado «En seguimiento», que es naranja de dominio y vive en su glifo, no en el cromo.',
    'Los bordes de tarjeta, las líneas divisorias y los fondos decorativos.',
  ],
  cuenta: {
    inicio: { hoy: '18 iconos + 18 bordes al pasar + 2 insignias', ahora: '8 marcas: 2 líneas urgentes de «Hoy», 4 insignias del menú, el logo y el raíl del módulo activo' },
    coldCalling: { hoy: 'chips activos + fila seleccionada + focos + 44 usos literales en el módulo', ahora: '4 dentro del área de trabajo: la cifra urgente, el chip activo, el raíl de la fila y el botón primario' },
  },
}

/* ------------------------------------------------------------------ */
/* Balance honesto                                                     */
/* ------------------------------------------------------------------ */

export const GANAS = [
  'De 10 a 22 filas en el portátil de un comercial: más del doble, y el texto de la celda pasa de 12 a 12,5 px.',
  'Cuatro niveles de texto en vez de dieciséis, todos por encima de 4,5:1 en los dos temas. Hoy fallan 682 usos en oscuro (31 %) y 804 en claro (37 %).',
  'La cabecera de columna sube de 3,80:1 a 5,38:1 y deja de ir en mayúsculas de 10 px.',
  'Las etiquetas y las notas del perfil de stock suben de 3,17:1 a 5,71 y 7,58.',
  'El botón primario deja de tener el texto a 2,94:1: tinta oscura sobre el naranja de marca, 6,17:1.',
  'En tema claro se vuelve a ver en qué módulo estás (hoy: 2,43:1).',
  'Un solo sistema de botones en vez de dos que conviven a 20 px de distancia con 16 px de diferencia de altura.',
  'El estado se lee por glifo y por palabra antes que por color, incluso cuando dos estados comparten color a propósito (simulacro y sin cambios).',
  'La barra lateral cabe entera: 670 px con los 18 módulos frente a 1.049.',
  'Un freno apagado lo dice con una etiqueta, no con la ausencia de un número.',
  'Se acabó la niebla animada de 25 s con blur(120px) detrás de todo: el contraste de una celda ya no depende de dónde caiga ni de qué segundo sea.',
]

export const PIERDES = [
  'EL TINTE DE FILA DEL EXCEL. Es la pérdida grande y no se arregla mirando para otro lado: el equipo lleva años leyendo el estado por el color del fondo de la fila. Se cambia por glifo + palabra en la segunda columna, y se deja un interruptor «Tinte Excel» para quien lo quiera de vuelta. Aun así, la primera semana se trabaja más despacio.',
  'DENSIDAD CONTRA DEDO GORDO. 28 px de fila y controles de 20 dentro son cómodos con ratón y trackpad, e incómodos con pantalla táctil. La versión móvil del catálogo ya es de solo consulta a propósito, así que encaja, pero cualquier idea de editar desde una tablet se complica.',
  'MENOS AIRE EN LAS PANTALLAS DE CONSULTA. Tesorería, Comisiones o Usos horarios no necesitan 32 filas; con esta densidad se ven algo apretadas. Merecerían un modo «cómodo» (fila de 34) que esta propuesta no trae.',
  'TRABAJO REAL DE MIGRACIÓN. Los 2.179 `text-white/XX` y los 720 `#FF6600` literales no se convierten solos, y los cinco `shared.ts` habría que centralizarlos conservando los nombres (`primaryButton`, `TH`, `cellShell`, `tableShell`, `STICKY_BG`…) o son 3.000 líneas de cambios en cinco módulos.',
  'MENOS IMPACTO EN LA PRIMERA IMPRESIÓN. Esto no luce en una captura para enseñar a un cliente. Está hecho para la hora tres, no para el segundo cinco. Si el ERP también se usa para enseñar, esta dirección no ayuda ahí.',
  'HAY QUE ARREGLAR LA CONFIGURACIÓN DE TAILWIND. Esta propuesta no usa `rounded-lg` porque en este repo son 24 px y no 8; si se adopta, la escala de radios del `tailwind.config.ts` hay que corregirla, y eso mueve las esquinas de 242 sitios que hoy están mal a propósito sin saberlo.',
]

export const CONSERVADO = [
  '`tabular-nums` en todo número (177 usos hoy): sin eso no se compara celda a celda contra el Excel del cliente.',
  'La cadena de tres `min-w-0` que mantiene el scroll horizontal dentro de la tabla. Comprobado en navegador: tabla de 1.728 px en una caja de 1.200, y la página no se mueve de lado.',
  'El fondo OPACO de la columna congelada y el escalonado de z-index: esquina 30 · cabecera 20 · primera columna 10 · resto 0.',
  '«Ver más (N restantes)» en vez de virtualizar, para que Ctrl+F, el scroll y la impresión se comporten igual en todas las tablas. Y va DENTRO del scroll, así que no cuesta cromo.',
  'La celda que no parece un campo hasta que pasas por encima.',
  'Guardado al salir del campo, sin botón — pero ahora con la confirmación que le faltaba.',
  'El estado siempre con palabra en castellano, y las pistas (`No coge, buzón o cuelga: hay que reintentar`).',
  '`simulacro` en gris y no en verde.',
  'Formato español en fechas e importes.',
]
