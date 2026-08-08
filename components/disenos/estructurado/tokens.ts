/**
 * PROPUESTA «ESTRUCTURADA POR CONTEXTO» — los tokens.
 *
 * Nada de esto toca el ERP: vive entero dentro de components/disenos/estructurado
 * y se aplica bajo un `.ctx-root` con `data-ctx-tema`. No hay ni una clase global,
 * ni un @import, ni una variable en :root. Se puede borrar la carpeta y no pasa nada.
 *
 * Las tres reglas del sistema:
 *   1. TRES niveles de texto, no dieciséis. Los tres por encima de 4,5:1 en los dos
 *      temas. Un cuarto tono («mute») existe solo para lo que NO es texto: el guion
 *      de «no hay dato» y el borde de los campos; está por encima de 3:1.
 *   2. El naranja significa DOS cosas y nada más: dónde estoy (la cuenta y el módulo
 *      activos) y qué tengo que hacer (la acción principal, los contadores que piden
 *      acción). Fuera de ahí, el naranja no aparece.
 *   3. Ningún estado se distingue solo por color: forma + icono + palabra, siempre.
 *      El tono del Excel se conserva, pero solo refuerza; nunca es el único portador.
 *
 * Todos los ratios de este fichero están MEDIDOS con la fórmula WCAG 2.1 sobre los
 * colores finales (no sobre el color nominal de un alfa), no estimados.
 */

export type Tema = 'claro' | 'oscuro'

/* ------------------------------------------------------------------ */
/* Neutros                                                             */
/* ------------------------------------------------------------------ */

export interface Neutros {
  /** Fondo de la página, el suelo de todo */
  bg: string
  /** Superficie de trabajo: paneles, tablas, tarjetas */
  surface: string
  /** Cebra de la tabla, fila bajo el ratón, franja de cabecera */
  surface2: string
  /** Hundido: el carril de navegación, la fila SELECCIONADA y la celda editable bajo el ratón */
  surface3: string
  /**
   * La fila bajo el ratón, y SOLO eso.
   *
   * Existe porque antes el hover y la fila seleccionada compartían `surface3`, y
   * la única diferencia entre «estoy pasando por encima» y «esta es la que elegí»
   * eran dos filetes de 1 px. En una tabla de 4.000 leads que se recorre con el
   * ratón encima, eso disfraza de seleccionada cualquier fila que se apunte.
   * Ahora el hover es un lavado suave y la seleccionada se queda el hundido de
   * verdad, más dos filetes de 2 px.
   */
  hover: string
  /** Filete: separadores de fila y de celda */
  line: string
  /** Filete estructural: contorno de panel, borde del carril */
  line2: string
  /** Texto 1 — el dato. Lo que se lee */
  fg: string
  /** Texto 2 — la etiqueta y el encabezado de columna. Lo que orienta */
  fg2: string
  /** Texto 3 — la nota y el contexto. Lo que explica */
  fg3: string
  /**
   * NO ES TEXTO, y aquí «no es texto» significa literalmente que no puede llevar
   * una palabra encima: solo el borde de los campos y el guion de «sin dato».
   * Está medido contra el umbral de 3:1 de gráfico, no contra el de 4,5:1, así
   * que cualquier cosa que se pueda leer va en `fg3`. Estuvo mal usado en cuatro
   * sitios —el marcador de posición de los campos, la celda vacía de la tabla, el
   * separador de las migas y la hora del último envío de stock en la portada— y
   * los cuatro han pasado a `fg3`.
   */
  mute: string
}

export const NEUTROS: Record<Tema, Neutros> = {
  claro: {
    bg: '#EFF1F4',
    surface: '#FFFFFF',
    surface2: '#F5F6F8',
    surface3: '#E7EAEE',
    hover: '#F0F2F5',
    line: '#DDE1E6',
    line2: '#C4CAD2',
    fg: '#15181D',
    fg2: '#4B535E',
    /* #5E6774 y no #616B78. La regla de la propuesta es que los TRES niveles de
       texto pasan 4,5:1 en los dos temas, y con #616B78 no era verdad del todo:
       sobre `surface3` daba 4,48 — y surface3 no es un rincón, es la fila de la
       tabla bajo el ratón y el carril de espacios, o sea dos sitios con texto de
       nivel 3 encima. Bajando la luz sin mover el tono, el peor par pasa a 4,74.
       Sobre superficie 5,72; sobre cebra 5,29; sobre el fondo de página 5,06. */
    fg3: '#5E6774',
    mute: '#7E8794',
  },
  oscuro: {
    bg: '#0E1014',
    surface: '#15181D',
    surface2: '#1B1F26',
    surface3: '#0A0C0F',
    hover: '#1F242C',
    line: '#262B33',
    line2: '#363D47',
    fg: '#EDEFF2',
    fg2: '#A5AEBA',
    fg3: '#8A94A1',
    mute: '#727C8A',
  },
}

/* ------------------------------------------------------------------ */
/* La marca                                                            */
/* ------------------------------------------------------------------ */

/**
 * El naranja de Liberty Seller se queda. Lo que cambia es que hay DOS naranjas
 * con dos trabajos distintos, y ninguno de los dos es «blanco sobre naranja»:
 * ese par da 2,94:1 en los dos temas y es el botón principal de todo el ERP de hoy.
 *
 *   - `fill`   → el naranja de marca, tal cual (#FF6600), como RELLENO, y siempre
 *                con etiqueta oscura encima: 6,31:1.
 *   - `texto`  → el naranja LEGIBLE, para cuando el naranja tiene que ser texto o
 *                un icono fino. Mismo tono, distinta luz. Es distinto en cada tema
 *                porque el problema es distinto: en claro el naranja de marca no
 *                llega ni al 3:1 de texto grande.
 */
export const MARCA: Record<Tema, { fill: string; sobreFill: string; texto: string; tenue: string }> = {
  claro: {
    fill: '#FF6600',
    sobreFill: '#1A1206',
    texto: '#B34700',
    /** Fondo tenue del contexto activo. Nunca lleva texto naranja encima */
    tenue: '#FFF1E6',
  },
  oscuro: {
    fill: '#FF6600',
    sobreFill: '#1A1206',
    texto: '#FF8B45',
    tenue: '#2A1808',
  },
}

/* ------------------------------------------------------------------ */
/* Semántica general: el vocabulario de estados del ERP                */
/* ------------------------------------------------------------------ */

export type Semantico = 'ok' | 'aviso' | 'error' | 'neutro' | 'info'

export const SEMANTICO: Record<Tema, Record<Semantico, { fg: string; bg: string; line: string }>> = {
  claro: {
    ok: { fg: '#10703C', bg: '#E4F3EA', line: '#B7DEC6' },
    aviso: { fg: '#8A5A00', bg: '#FAF0D9', line: '#E6D19C' },
    error: { fg: '#B3261E', bg: '#FBE9E7', line: '#F0BDB8' },
    neutro: { fg: '#4B535E', bg: '#EDEFF2', line: '#D5D9DF' },
    info: { fg: '#0B6F82', bg: '#E1F2F6', line: '#AFD9E2' },
  },
  oscuro: {
    ok: { fg: '#5DDC98', bg: '#10271B', line: '#1E4A33' },
    aviso: { fg: '#F2C14E', bg: '#2A2110', line: '#4C3C15' },
    error: { fg: '#FF8A80', bg: '#2C1512', line: '#512521' },
    neutro: { fg: '#A5AEBA', bg: '#1B1F26', line: '#333A44' },
    info: { fg: '#22C8E4', bg: '#0D2830', line: '#17444F' },
  },
}

/* ------------------------------------------------------------------ */
/* Los siete estados de Cold Calling                                   */
/* ------------------------------------------------------------------ */

/**
 * Los tonos del Excel se CONSERVAN —el equipo se los sabe y reaprenderlos cuesta
 * dinero—, pero se les mueve la luz para que se lean también en tema claro. El tono
 * es el mismo: sigue siendo «el amarillo», «el cian», «el magenta».
 *
 * Medido sobre blanco con los hues originales: amarillo #EAB308 → 1,92:1,
 * verde #22C55E → 2,28:1, cian #06B6D4 → 2,43:1. Como marca de 4 px sobre fondo
 * claro, tres de los siete son invisibles. Con la variante clara de aquí abajo, los
 * siete pasan de 5,4:1.
 *
 * Y aun así el color NUNCA va solo: cada estado lleva su icono propio y su palabra.
 * Ver `ICONO_ESTADO` en piezas.tsx.
 */
export const ESTADO_COLOR: Record<Tema, Record<string, string>> = {
  claro: {
    pendiente: '#5E6774',
    no_contesta: '#8A6300',
    programado: '#0B6F82',
    email_enviado: '#9A28AE',
    seguimiento: '#A84F09',
    cita_cualificada: '#157A3B',
    no_interesa: '#B51E18',
  },
  oscuro: {
    pendiente: '#8A94A1',
    no_contesta: '#EAB308',
    programado: '#22C8E4',
    email_enviado: '#E86BF7',
    seguimiento: '#FB8C3C',
    cita_cualificada: '#3ADD79',
    no_interesa: '#FF6B6B',
  },
}

/* ------------------------------------------------------------------ */
/* Tipografía: cinco tamaños, tres grosores                            */
/* ------------------------------------------------------------------ */

export interface NivelTipo {
  nombre: string
  px: number
  interlineado: number
  grosor: 400 | 500 | 600
  tracking: string
  para: string
}

/** Hoy hay 28 tamaños en dos sistemas paralelos y seis grosores cargados (dos sin usar). */
export const TIPOGRAFIA: NivelTipo[] = [
  {
    nombre: 'ctx-xl',
    px: 19,
    interlineado: 26,
    grosor: 600,
    tracking: '-0.01em',
    para: 'El contexto: el nombre de la cuenta sobre la que se trabaja. Uno por pantalla y ninguno más.',
  },
  {
    nombre: 'ctx-lg',
    px: 15,
    interlineado: 22,
    grosor: 600,
    tracking: '-0.005em',
    para: 'Título de panel o de sección. Lo que agrupa.',
  },
  {
    nombre: 'ctx-md',
    px: 13,
    interlineado: 18,
    grosor: 400,
    tracking: '0',
    para: 'EL NIVEL DE TRABAJO: la celda de la tabla, el valor de un campo, el cuerpo. Aquí vive el 80 % del texto.',
  },
  {
    nombre: 'ctx-sm',
    px: 12,
    interlineado: 16,
    grosor: 400,
    tracking: '0',
    para: 'Secundario: la nota que explica un campo, el subtítulo, el dato de apoyo.',
  },
  {
    nombre: 'ctx-xs',
    px: 11,
    interlineado: 14,
    grosor: 600,
    tracking: '0.02em',
    para: 'Etiqueta de campo y cabecera de columna. Nunca por debajo de 11 px, y nunca por debajo de fg2.',
  },
]

/* ------------------------------------------------------------------ */
/* Densidad                                                            */
/* ------------------------------------------------------------------ */

export type Densidad = 'compacta' | 'normal' | 'comoda'

export const DENSIDAD: Record<Densidad, { fila: number; texto: number; interlineado: number; etiqueta: string }> = {
  compacta: { fila: 24, texto: 12, interlineado: 16, etiqueta: 'Compacta' },
  normal: { fila: 28, texto: 13, interlineado: 18, etiqueta: 'Normal' },
  comoda: { fila: 32, texto: 13, interlineado: 18, etiqueta: 'Cómoda' },
}

/** Alto de la cabecera de la tabla, igual en las tres densidades */
export const ALTO_CABECERA_TABLA = 26

/* ------------------------------------------------------------------ */
/* Geometría                                                           */
/* ------------------------------------------------------------------ */

/**
 * Tres radios y monótonos. Hoy la escala está rota en tailwind.config.ts:
 * `rounded-lg` pinta 24 px —más que `rounded-xl` (12) y que `rounded-2xl` (16)—
 * y tiene 242 usos, casi todos escritos esperando 8.
 */
export const RADIO = { chip: '3px', control: '6px', panel: '10px' } as const

export const ALTO = {
  barraSuperior: 48,
  /* 60 y no 52: el nombre del espacio —«Mi trabajo», «Mis clientes», «Agencia»—
     es el nivel 1 de navegación de toda la propuesta y estaba a 9 px para que
     cupiera. Nueve píxeles por debajo del mínimo que la propia TIPOGRAFIA se
     impone (11) no se sostiene a catorce pulgadas y ocho horas. Ensanchar el
     carril cuesta 8 px horizontales; el texto sube a 11 px y a fg2. */
  carril: 60,
  navegacion: 232,
  control: 28,
  cabeceraTabla: ALTO_CABECERA_TABLA,
} as const
