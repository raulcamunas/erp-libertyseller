/**
 * EL CONTRATO DE ESTILO DE LAS PANTALLAS NUEVAS.
 *
 * Aquí viven las clases —y solo las clases— con las que se escriben las
 * pantallas que nacen ya con la estética «Denso y sobrio»: el módulo A1 de la
 * plataforma y los tres exploradores de origen de fichero. Nada de esto se
 * aplica a los veinte módulos que ya existen: esos siguen con su espaciado de
 * hoy y solo cambian de color, por la capa de traducción de app/globals.css.
 *
 * POR QUÉ LAS PANTALLAS NUEVAS SÍ NACEN DENSAS
 * Porque no hay memoria muscular que romper. Cambiar el alto de fila de un
 * módulo que cuatro comerciales usan ocho horas al día cuesta una semana de
 * trabajo más lento; estrenarlo denso no cuesta nada. Estas pantallas son la
 * muestra de cómo va a quedar el ERP entero cuando toque la migración de
 * densidad, y hasta entonces son el único sitio donde se ve.
 *
 * DE DÓNDE SALEN LOS VALORES
 * De components/disenos/denso/estilos.ts, que es la propuesta elegida. Los
 * colores NO se repiten aquí como hexadecimales: se leen de los tokens `--ls-*`
 * que declara app/globals.css, para que exista UNA sola paleta y no dos que se
 * separan con el tiempo. La densidad sí está aquí en números, porque en
 * globals.css no hay nada de densidad a propósito.
 *
 * TRES COSAS QUE HAY QUE SABER ANTES DE EDITAR ESTE FICHERO
 *
 * 1. LOS RADIOS VAN EN VALOR ARBITRARIO, NO EN LA ESCALA DE TAILWIND. En este
 *    repositorio `rounded-lg` son 24 px y `rounded-xl` 12, o sea que la escala
 *    está invertida y los 242 usos de `rounded-lg` del ERP pintan esquinas del
 *    doble de lo que esperaba quien las escribió. Mientras eso no se arregle en
 *    tailwind.config.ts, aquí se escribe `rounded-[6px]` y no `rounded-md`.
 *
 * 2. LA ALTURA DE FILA MANDA SOBRE EL CONTROL QUE VA DENTRO, no al revés. La
 *    fila mide 28 px porque el control de dentro mide 20 y no porque quepa de
 *    milagro. Si se mete un <select> nativo de 26,5 px en una celda, la fila
 *    crece y el contrato deja de valer: usa CELDA.editable.
 *
 * 3. NO METAS COLORES SUELTOS. Si necesitas un verde, sale de COLOR_ESTADO. El
 *    motivo está medido: hoy el ERP tiene nueve mapas de estado distintos en
 *    lib/types/** y dieciséis niveles de opacidad de texto, y así es como se
 *    llega a que dos pantallas pinten el mismo estado de dos colores.
 */

/* ------------------------------------------------------------------ */
/* 1. Texto — CUATRO niveles. Ni uno más.                              */
/* ------------------------------------------------------------------ */

/**
 * Los cuatro niveles de la escala, con su papel. Medidos sobre la superficie de
 * tarjeta: 16,45 · 11,58 · 7,58 · 5,71 en oscuro, y 18,11 · 10,76 · 6,96 · 5,21
 * en claro. El más bajo de los cuatro pasa 4,5:1 sobre las cinco superficies.
 */
export const TEXTO = {
  /** El dato: el nombre de la cuenta, la cifra, el título. */
  t1: 'text-[var(--ls-t1)]',
  /** El dato de al lado: la celda normal, el valor de un campo. */
  t2: 'text-[var(--ls-t2)]',
  /** El contexto: la nota que explica un campo, el subtítulo, el ASIN. */
  t3: 'text-[var(--ls-t3)]',
  /** El rótulo: la cabecera de columna, la etiqueta de campo, la unidad. */
  t4: 'text-[var(--ls-t4)]',
  /** El naranja de marca cuando hace de TEXTO. Solo para lo que espera acción. */
  acento: 'text-[var(--ls-acc)]',
} as const

/**
 * Los cinco tamaños. Sin mayúsculas en ninguno: a 10-11 px son la forma más
 * lenta de leer una palabra, y hoy hay 236 `uppercase` en el ERP casi siempre
 * con `tracking-wider` encima.
 */
export const TIPO = {
  /** 15 px / 600. Título de pantalla. Uno por vista. */
  xl: 'text-[15px] font-semibold tracking-[-0.012em]',
  /** 13 px / 600. Cabecera de panel, nombre de sección, dato destacado. */
  l: 'text-[13px] font-semibold tracking-[-0.006em]',
  /** 12,5 px / 400. EL TEXTO DE TRABAJO: celdas, valores, campos. */
  m: 'text-[12.5px] font-normal',
  /** 11,5 px / 400. Contexto: notas al pie de campo, descripciones. */
  s: 'text-[11.5px] font-normal leading-[1.5]',
  /** 11 px / 600. Rótulos: cabecera de columna, etiqueta de campo. */
  xs: 'text-[11px] font-semibold',
  /** Todo número que se compare celda a celda. */
  num: 'tabular-nums',
} as const

/* ------------------------------------------------------------------ */
/* 2. Superficies — OPACAS y escalonadas                               */
/* ------------------------------------------------------------------ */

export const SUPERFICIE = {
  /** La página. */
  fondo: 'bg-[var(--ls-fondo)]',
  /** La tabla, la tarjeta, el panel. */
  sup: 'bg-[var(--ls-sup)]',
  /** Elevación: cabecera de tabla, columna congelada, barra de filtros. */
  sup2: 'bg-[var(--ls-sup2)]',
  /** La fila bajo el ratón, el control activo. */
  sup3: 'bg-[var(--ls-sup3)]',
  /** La fila en la que estás. */
  sel: 'bg-[var(--ls-sel)]',
} as const

export const LINEA = {
  /** El separador de siempre. */
  normal: 'border-[var(--ls-linea)]',
  /** El separador que sí tiene que verse: cabecera, columna congelada. */
  fuerte: 'border-[var(--ls-linea2)]',
} as const

/** Los tres radios, monótonos: 4 · 6 · 10. */
export const RADIO = {
  r1: 'rounded-[4px]',
  r2: 'rounded-[6px]',
  r3: 'rounded-[10px]',
} as const

/* ------------------------------------------------------------------ */
/* 3. Título de sección                                                */
/* ------------------------------------------------------------------ */

export const TITULO = {
  /** Título de pantalla. Uno por vista. */
  pantalla: 'text-[15px] font-semibold tracking-[-0.012em] text-[var(--ls-t1)]',
  /** Título de sección o de panel. */
  seccion: 'text-[13px] font-semibold tracking-[-0.006em] text-[var(--ls-t1)]',
  /** El rótulo de un grupo: 11 px, caja normal, nivel más bajo. */
  rotulo: 'text-[11px] font-semibold text-[var(--ls-t4)]',
  /** La frase que explica de qué va la pantalla, debajo del título. */
  entradilla: 'text-[11.5px] leading-[1.5] text-[var(--ls-t3)]',
} as const

/* ------------------------------------------------------------------ */
/* 4. La tabla — el corazón                                            */
/* ------------------------------------------------------------------ */

/**
 * Fila de 28 px y cabecera de 26, contra los 35,5 y 27,5 de hoy. En el portátil
 * de un comercial eso son 22 filas en vez de 10.
 *
 * La cadena de `min-w-0` de `caja` no es cosmética: sin ella una tabla ancha
 * estira el `<main>` y arrastra la página entera en horizontal, barra lateral
 * incluida. Quien scrollea tiene que ser la caja, no la página.
 */
export const TABLA = {
  caja: 'flex-1 min-h-0 min-w-0 overflow-auto rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]',
  tabla: 'w-full min-w-max border-separate border-spacing-0 text-[12.5px]',
  /** Cabecera pegajosa. z-20; la esquina congelada va a 30 y las celdas fijas a 10. */
  cabecera:
    'sticky top-0 z-20 h-[26px] px-2 text-left text-[11px] font-semibold whitespace-nowrap ' +
    'text-[var(--ls-t4)] bg-[var(--ls-sup2)] border-b border-[var(--ls-linea2)]',
  celda:
    'h-7 px-2 align-middle whitespace-nowrap text-[var(--ls-t2)] border-b border-[var(--ls-linea)]',
  /** Se pone en el <tr>. El fondo de la celda congelada se repinta aparte. */
  fila: 'hover:[&>td]:bg-[var(--ls-sup3)]',
  /** La fila en la que estás. Es el único naranja de la tabla. */
  filaSel: '[&>td]:bg-[var(--ls-sel)] [&>td:first-child]:text-[var(--ls-t1)]',
  /** Columna congelada: fondo OPACO, o el texto de las otras columnas la cruza. */
  cabeceraFija: 'sticky left-0 z-30 border-r border-[var(--ls-linea2)]',
  celdaFija: 'sticky left-0 z-10 bg-[var(--ls-sup)] border-r border-[var(--ls-linea2)]',
  derecha: 'text-right',
  numero: 'text-right tabular-nums',
  /** Para que un texto largo no ensanche la columna. */
  corta: 'block overflow-hidden text-ellipsis',
} as const

/**
 * La celda editable: no parece un campo hasta que pasas por encima. Es lo único
 * que impide que doce columnas editables se lean como un formulario. Mide 20 px
 * para que la fila siga midiendo 28.
 */
export const CELDA = {
  editable:
    'block w-full h-5 px-[5px] rounded-[4px] border border-transparent bg-transparent ' +
    'text-[12.5px] text-[var(--ls-t2)] overflow-hidden text-ellipsis whitespace-nowrap ' +
    'hover:bg-[var(--ls-sup2)] hover:border-[var(--ls-linea)] ' +
    'focus:bg-[var(--ls-sup2)] focus:border-[var(--ls-acc-graf)] focus:outline-none ' +
    'focus:shadow-[inset_0_0_0_1px_var(--ls-acc-graf)]',
  /** Cuando no hay dato. Sigue siendo legible: 5,71:1, no un guion fantasma. */
  vacia: 'text-[var(--ls-t4)]',
  numero: 'text-right tabular-nums',
} as const

/* ------------------------------------------------------------------ */
/* 5. Tarjeta y panel                                                  */
/* ------------------------------------------------------------------ */

export const TARJETA = {
  /** La caja de contenido de siempre. */
  base: 'min-w-0 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]',
  /** Su cabecera: 30 px, con el título dentro. */
  cabecera:
    'flex h-[30px] items-center gap-2 px-[10px] border-b border-[var(--ls-linea)]',
  cuerpo: 'px-[10px] py-[9px]',
} as const

/**
 * La tira de cifras: 28 px de alto para las cuatro métricas de cabecera, en vez
 * de cuatro tarjetas de 57,5 que se comen media pantalla antes del primer dato.
 */
export const CIFRAS = {
  tira: 'flex h-7 shrink-0 items-center overflow-hidden rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]',
  celda:
    'flex h-full items-baseline gap-[5px] whitespace-nowrap px-[11px] ' +
    'border-r border-[var(--ls-linea)] last:border-r-0',
  valor: 'text-[12.5px] font-semibold tabular-nums text-[var(--ls-t1)]',
  rotulo: 'text-[11px] text-[var(--ls-t4)]',
  /** La cifra que hay que atender hoy. Naranja, y solo esta. */
  urgente: 'text-[var(--ls-acc)]',
} as const

/* ------------------------------------------------------------------ */
/* 6. Botones — DOS, no dos sistemas                                   */
/* ------------------------------------------------------------------ */

/**
 * Hoy conviven dos: `<Button>` de 48 px en mayúsculas y `primaryButton` de 32 px
 * en caja normal, a veces a 20 px uno del otro en la misma pantalla. Aquí hay
 * uno, con dos tonos y una variante alta.
 *
 * El primario lleva TINTA OSCURA sobre el naranja de marca: 6,17:1 en los dos
 * temas. El texto blanco sobre #FF6600 que usan hoy los 160 botones primarios
 * del ERP da 2,94:1.
 */
export const BOTON = {
  base:
    'inline-flex h-6 items-center gap-[5px] whitespace-nowrap rounded-[6px] px-[9px] ' +
    'text-[11.5px] font-medium border ' +
    'disabled:opacity-45 disabled:cursor-default ' +
    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ls-acc-graf)]',
  /** Uno por pantalla. */
  primario:
    'border-[var(--ls-acc-borde)] bg-[var(--ls-acc-relleno)] text-[var(--ls-acc-tinta)] ' +
    'font-semibold hover:brightness-110',
  secundario:
    'border-[var(--ls-linea)] bg-[var(--ls-sup)] text-[var(--ls-t2)] ' +
    'hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)] hover:border-[var(--ls-linea2)]',
  /** Para cuando el botón va solo y no en una barra de filtros. */
  alto: 'h-7 px-[11px]',
  /** El botón de icono de la tabla: 20 px, el nivel de texto más bajo. */
  icono:
    'inline-flex h-5 w-5 items-center justify-center rounded-[4px] text-[var(--ls-t4)] ' +
    'hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]',
  /** Chip de filtro. `encendido` se añade, no sustituye. */
  chip:
    'inline-flex h-6 items-center gap-[5px] whitespace-nowrap rounded-[6px] px-2 ' +
    'border border-[var(--ls-linea)] bg-[var(--ls-sup)] text-[11.5px] text-[var(--ls-t3)] ' +
    'hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]',
  /**
   * El estado encendido. LOS TRES `!` SON OBLIGATORIOS Y NO SON UN ADORNO.
   *
   * `chipEncendido` se CONCATENA a `chip`, así que las dos clases de fondo
   * conviven en el mismo elemento con la misma especificidad (0,1,0) y decide el
   * ORDEN DE LA HOJA compilada, no el orden en el atributo `class`. Y ese orden
   * lo pone Tailwind alfabéticamente por el valor arbitrario:
   *
   *     .bg-[var(--ls-acc-suave)]   regla 687
   *     .bg-[var(--ls-sup)]         regla 691   <- ganaba esta
   *
   * O sea que el chip encendido se pintaba EXACTAMENTE IGUAL que el apagado, en
   * todos los sitios donde se usa, sin dar ningún error: las pestañas, los
   * filtros de seguimiento, el selector de país y la ventana de la ficha de SKU.
   * Medido en el navegador sobre la hoja compilada (1.663 reglas).
   *
   * Con `!` ganan por origen de la cascada y no por orden, que es lo único que
   * no depende de cómo compile Tailwind mañana ni de qué nombre tenga la
   * variable. Es el mismo razonamiento que llevó a prefijar con `html` la capa
   * de traducción de app/globals.css.
   */
  chipEncendido:
    '!border-[var(--ls-acc-graf)] !bg-[var(--ls-acc-suave)] !text-[var(--ls-t1)]',
} as const

/* ------------------------------------------------------------------ */
/* 7. Campos                                                           */
/* ------------------------------------------------------------------ */

/**
 * La etiqueta va a 11 px en caja normal y al nivel de rótulo: 5,71:1. Hoy es
 * `text-[10px] uppercase tracking-wider text-white/35`, o sea 3,17:1, y son los
 * nombres de los ~50 campos que hay que configurar para que a un cliente no se
 * le vacíe el inventario.
 *
 * La nota va un nivel POR ENCIMA de la etiqueta (7,58:1) porque es la que
 * explica qué hace el campo: si no se lee, la pantalla no se puede usar.
 */
export const CAMPO = {
  contenedor: 'min-w-0',
  etiqueta: 'block mb-[3px] text-[11px] font-semibold text-[var(--ls-t4)]',
  input:
    'w-full h-[26px] px-2 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] ' +
    'text-[12.5px] text-[var(--ls-t1)] outline-none ' +
    'placeholder:text-[var(--ls-t4)] hover:border-[var(--ls-linea2)] ' +
    'focus:border-[var(--ls-acc-graf)] focus:shadow-[inset_0_0_0_1px_var(--ls-acc-graf)]',
  numero: 'text-right tabular-nums',
  nota: 'mt-[3px] text-[11px] leading-[1.5] text-[var(--ls-t3)]',
  /** El asterisco de campo obligatorio. Uno de los pocos naranjas permitidos. */
  obligatorio: 'text-[var(--ls-acc)]',
  /** Rejilla de campos. El minmax evita que un campo se quede en 80 px. */
  rejilla: 'grid gap-x-[14px] gap-y-[9px] [grid-template-columns:repeat(auto-fit,minmax(215px,1fr))]',
} as const

/* ------------------------------------------------------------------ */
/* 8. Estado — glifo, palabra y DESPUÉS color                          */
/* ------------------------------------------------------------------ */

/**
 * Los siete tonos del Excel del equipo, más azul y violeta que el ERP ya usa.
 * Todos por encima de 4,5:1 sobre las cinco superficies, en los dos temas.
 *
 * ESTO ES LA ÚNICA FUENTE DE VERDES. Si una pantalla nueva necesita un color de
 * estado, sale de aquí. Hoy hay nueve mapas de estado repartidos por
 * lib/types/** y por eso el mismo estado se pinta distinto según la pantalla.
 */
export type TonoEstado =
  | 'gris'
  | 'ambar'
  | 'cian'
  | 'magenta'
  | 'naranja'
  | 'verde'
  | 'rojo'
  | 'azul'
  | 'violeta'

/** El color, como valor CSS. Para `style={{ color: COLOR_ESTADO.verde }}`. */
export const COLOR_ESTADO: Record<TonoEstado, string> = {
  gris: 'var(--ls-e-gris)',
  ambar: 'var(--ls-e-ambar)',
  cian: 'var(--ls-e-cian)',
  magenta: 'var(--ls-e-magenta)',
  naranja: 'var(--ls-e-naranja)',
  verde: 'var(--ls-e-verde)',
  rojo: 'var(--ls-e-rojo)',
  azul: 'var(--ls-e-azul)',
  violeta: 'var(--ls-e-violeta)',
}

/** El mismo color, como clase de texto. */
export const TEXTO_ESTADO: Record<TonoEstado, string> = {
  gris: 'text-[var(--ls-e-gris)]',
  ambar: 'text-[var(--ls-e-ambar)]',
  cian: 'text-[var(--ls-e-cian)]',
  magenta: 'text-[var(--ls-e-magenta)]',
  naranja: 'text-[var(--ls-e-naranja)]',
  verde: 'text-[var(--ls-e-verde)]',
  rojo: 'text-[var(--ls-e-rojo)]',
  azul: 'text-[var(--ls-e-azul)]',
  violeta: 'text-[var(--ls-e-violeta)]',
}

/**
 * El estado dentro de una tabla: primero el GLIFO (forma), después la PALABRA
 * (texto) y solo al final el color. Tapa el color con la mano y la pantalla
 * sigue funcionando — que es lo que necesita el 8 % de los hombres que no
 * distingue rojo de verde, y hoy hay tres sitios del ERP donde el estado es
 * SOLO color.
 *
 * El color va en el ICONO, no en la palabra: la palabra se queda en el nivel de
 * texto normal para no tener nueve tonos de párrafo por pantalla.
 */
export const ESTADO = {
  linea: 'inline-flex items-center gap-[5px] whitespace-nowrap text-[11.5px] text-[var(--ls-t2)]',
  icono: 'h-[13px] w-[13px] shrink-0',
  palabra: 'font-normal',
  /** Cuando el estado es EL dato de la fila y no un adorno. */
  fuerte: 'font-medium text-[var(--ls-t1)]',
} as const

/**
 * La insignia de estado, para cuando el estado es el dato principal: cabecera
 * de ficha, historial, resultado de un job. En una tabla de cientos de filas
 * usa ESTADO.linea, que no mete una caja por fila.
 */
export const INSIGNIA = {
  base:
    'inline-flex h-[19px] items-center gap-[5px] whitespace-nowrap rounded-[6px] ' +
    'pl-[6px] pr-[7px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] ' +
    'text-[11px] font-medium text-[var(--ls-t2)]',
  icono: 'h-3 w-3 shrink-0',
  /** Contador naranja: solo para lo que espera una acción tuya. */
  contador:
    'inline-flex h-4 min-w-[17px] items-center justify-center rounded-[4px] px-1 ' +
    'border border-[var(--ls-acc-borde)] bg-[var(--ls-acc-relleno)] ' +
    'text-[10.5px] font-bold tabular-nums text-[var(--ls-acc-tinta)]',
} as const

/**
 * El aviso. Lleva filo de color a la izquierda además del icono: dos señales,
 * no solo el tono. Va con `style={{ borderLeftColor: COLOR_ESTADO[tono] }}`.
 */
export const AVISO = {
  base:
    'flex gap-[7px] rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] ' +
    'px-[9px] py-[7px] text-[11.5px] leading-[1.5] text-[var(--ls-t2)]',
  conTono: 'border-l-2',
  icono: 'mt-[2px] h-[13px] w-[13px] shrink-0',
  fuerte: 'font-semibold text-[var(--ls-t1)]',
} as const

/* ------------------------------------------------------------------ */
/* 9. Armazón de pantalla                                              */
/* ------------------------------------------------------------------ */

export const PANTALLA = {
  /** Columna principal. El `min-w-0` mantiene el scroll dentro de la tabla. */
  cuerpo: 'flex flex-col gap-2 min-h-0 min-w-0',
  /** La barra de filtros: 32 px, una sola fila. */
  filtros: 'flex h-8 shrink-0 items-center gap-[6px] min-w-0',
  separador: 'h-4 w-px shrink-0 bg-[var(--ls-linea2)]',
  fila: 'flex items-center gap-2 min-w-0',
  crece: 'flex-1 min-w-0',
} as const
