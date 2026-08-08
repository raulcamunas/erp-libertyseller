/**
 * EL REGISTRO DEL COMPARADOR.
 *
 * Aquí no se inventa ni un número. Cada propuesta trae su propia memoria en
 * datos —`denso/memoria.ts`, `claro/memoria.ts`, `estructurado/MEMORIA.ts`— y
 * este fichero se limita a NORMALIZARLAS a una forma común para que la ficha se
 * pinte igual para las tres y se puedan poner en la misma tabla. Cada una las
 * midió a su manera (unas con `getComputedStyle` en navegador, otras aplicando
 * WCAG 2.1 al color compuesto), así que la fuente de cada cifra va dicha en la
 * ficha, no escondida.
 *
 * Si mañana una propuesta cambia un color y actualiza su memoria, la ficha y la
 * tabla comparativa cambian solas. Ese es el motivo de leer de sus ficheros en
 * vez de copiar las cifras aquí.
 *
 * Lo ÚNICO que se escribe en este fichero es el bloque «adopción»: cuántos
 * ficheros del ERP tocaría cada dirección y si se puede hacer por partes. Va
 * marcado como lo que es —una lectura del comparador, contada sobre el
 * repositorio— salvo en la propuesta estructurada, que trae su propio plan por
 * pasos y se usa el suyo.
 */

import * as DENSO from '../denso/memoria'
import * as CLARO from '../claro/memoria'
import * as ESTRUCTURADO from '../estructurado/MEMORIA'

export type IdPropuesta = 'hoy' | 'denso' | 'claro' | 'estructurado'
export type Modo = 'claro' | 'oscuro'

/* ------------------------------------------------------------------ */
/* La forma común                                                      */
/* ------------------------------------------------------------------ */

export interface NivelTipo {
  nombre: string
  px: number
  grosor: number
  para: string
}

export interface TokenColor {
  rol: string
  claro: string
  oscuro: string
  para: string
}

export interface Contraste {
  par: string
  claro: number
  oscuro: number
  umbral: number
  /** Lo que da hoy la misma combinación, cuando la propuesta lo aporta */
  hoyClaro?: number
  hoyOscuro?: number
  donde?: string
}

export interface FilaDensidad {
  viewport: number
  contexto: string
  hoy: number
  propuesta: number
}

export interface Adopcion {
  /** De dónde sale este bloque: de la propuesta o de la lectura del comparador */
  fuente: string
  ficheros: { que: string; cuantos: string }[]
  porPartes: boolean
  pasos: { titulo: string; que: string }[]
  aviso?: string
}

export interface Propuesta {
  id: IdPropuesta
  nombre: string
  /** Una línea para el selector, no la idea entera */
  lema: string
  idea: string
  modoPrincipal: Modo
  porQueEseModo: string[]
  tipografia: NivelTipo[]
  tipografiaNota: string
  paleta: TokenColor[]
  contrastes: Contraste[]
  /** El peor par de TEXTO de la propuesta, por modo */
  contrasteMinimo: { claro: number; oscuro: number }
  nivelesDeTexto: number
  tamanosDeLetra: number
  densidad: FilaDensidad[]
  alturaFila: { hoy: number; propuesta: number }
  cromo: { hoy: number; propuesta: number }
  acento: { si: string[]; no: string[]; resumen: string }
  ganas: string[]
  pierdes: string[]
  adopcion: Adopcion
  /** Cómo se midió, para que cada cifra tenga procedencia */
  comoSeMidio: string
}

/* ------------------------------------------------------------------ */
/* Adaptador: DENSO                                                    */
/* ------------------------------------------------------------------ */

/**
 * La paleta de «denso» viene partida por tema y por familia; las otras dos
 * vienen ya emparejadas. Se emparejan por nombre de token, que es el mismo en
 * los dos temas, y los tokens que solo existen en claro (`--dz-acc-graf`,
 * `--dz-acc-borde`) se añaden al final con su hueco marcado.
 */
function paletaDenso(): TokenColor[] {
  const claros = new Map<string, { hex: string; para: string }>()
  for (const grupo of [DENSO.PALETA.claro.superficies, DENSO.PALETA.claro.texto, DENSO.PALETA.claro.acento]) {
    for (const t of grupo) claros.set(t.token, { hex: t.hex, para: t.para })
  }

  const salida: TokenColor[] = []
  const vistos = new Set<string>()
  for (const grupo of [DENSO.PALETA.oscuro.superficies, DENSO.PALETA.oscuro.texto, DENSO.PALETA.oscuro.acento]) {
    for (const t of grupo) {
      vistos.add(t.token)
      salida.push({
        rol: t.token.replace('--dz-', ''),
        oscuro: t.hex,
        claro: claros.get(t.token)?.hex ?? t.hex,
        para: t.para,
      })
    }
  }
  for (const [token, v] of claros) {
    if (vistos.has(token)) continue
    salida.push({ rol: token.replace('--dz-', ''), claro: v.hex, oscuro: '—', para: v.para })
  }
  return salida
}

const denso: Propuesta = {
  id: 'denso',
  nombre: 'Denso y sobrio',
  lema: 'Herramienta de trabajo: fila de 28 px y cuatro niveles de texto',
  idea: DENSO.IDEA,
  modoPrincipal: 'oscuro',
  porQueEseModo: DENSO.POR_QUE_OSCURO,
  tipografia: DENSO.TIPOGRAFIA.tamanos.map((t) => ({
    nombre: t.clase.replace('dz-', ''),
    px: t.px,
    grosor: t.grosor,
    para: t.para,
  })),
  tipografiaNota: `${DENSO.TIPOGRAFIA.antes} Ahora: ${DENSO.TIPOGRAFIA.despues} ${DENSO.TIPOGRAFIA.mayusculas}`,
  paleta: paletaDenso(),
  contrastes: DENSO.CONTRASTE.map((c) => ({ par: c.par, claro: c.claro, oscuro: c.oscuro, umbral: 4.5 })),
  contrasteMinimo: DENSO.CONTRASTE_MINIMO,
  nivelesDeTexto: 4,
  tamanosDeLetra: DENSO.TIPOGRAFIA.tamanos.length,
  densidad: DENSO.DENSIDAD.filas.map((f) => ({
    viewport: f.viewport,
    contexto: f.contexto,
    hoy: f.hoy,
    propuesta: f.ahora,
  })),
  alturaFila: { hoy: DENSO.DENSIDAD.alturaFila.hoy, propuesta: DENSO.DENSIDAD.alturaFila.ahora },
  cromo: { hoy: DENSO.DENSIDAD.cromo.hoy, propuesta: DENSO.DENSIDAD.cromo.ahora },
  acento: {
    si: DENSO.NARANJA.si,
    no: DENSO.NARANJA.no,
    resumen: `${DENSO.NARANJA.regla} En la portada: ${DENSO.NARANJA.cuenta.inicio.ahora}, frente a ${DENSO.NARANJA.cuenta.inicio.hoy} de hoy.`,
  },
  ganas: DENSO.GANAS,
  pierdes: DENSO.PIERDES,
  comoSeMidio:
    'Ratios leídos con getComputedStyle sobre los componentes reales renderizados en navegador, no calculados sobre el color nominal. Alturas de fila y recuento de filas leídos del DOM (clientHeight de la caja de la tabla dividido entre la altura de fila real).',
  adopcion: {
    fuente:
      'Lectura del comparador. El README de la propuesta enumera el trabajo de migración pero no lo ordena en pasos; los ficheros están contados sobre el repositorio en el momento de escribir esto.',
    ficheros: [
      { que: 'app/globals.css y tailwind.config.ts (la escala de radios está rota: rounded-lg son 24 px y no 8)', cuantos: '2 ficheros' },
      { que: 'Los cinco shared.ts, centralizados en uno CONSERVANDO los nombres (primaryButton, TH, cellShell, tableShell, STICKY_BG…)', cuantos: '5 → 1' },
      { que: 'Armazón: layout del dashboard, barra lateral y rejilla de inicio', cuantos: '3 ficheros' },
      { que: 'Las dos tablas que se miran ocho horas: Cold Calling y el catálogo de Amazon', cuantos: '2 componentes' },
      { que: 'Los text-white/XX repartidos por el ERP, que no se convierten con un reemplazo automático', cuantos: '2.207 usos en 176 ficheros' },
      { que: 'Los #FF6600 literales', cuantos: '723 usos en 123 ficheros' },
      { que: 'glass-card', cuantos: '191 usos en 54 ficheros' },
    ],
    porPartes: true,
    pasos: [
      {
        titulo: '1 · Los tokens, con los nombres de hoy',
        que: 'Un solo fichero de tokens que sustituye a los cinco shared.ts conservando cada nombre. Cambia el valor, no el nombre, así que los módulos no se tocan. Aquí se arreglan de golpe la cabecera de tabla a 3,80:1 y el botón blanco sobre naranja.',
      },
      {
        titulo: '2 · La escala de radios de Tailwind',
        que: 'Corregir rounded-lg/xl/2xl en tailwind.config.ts. Mueve las esquinas de los 242 sitios que hoy están a 24 px sin que nadie lo decidiera; hay que mirarlas una vez.',
      },
      {
        titulo: '3 · Las dos tablas largas',
        que: 'Cold Calling y el catálogo de Amazon a la fila de 28 px y al patrón de estado con glifo. Es donde están las horas y donde se nota el cambio.',
      },
      {
        titulo: '4 · El armazón y la retirada del cristal',
        que: 'Barra lateral, rejilla de inicio, glass-card y el fondo animado. Lo último, porque es lo más visible y lo que menos trabajo diario arregla.',
      },
    ],
    aviso:
      'Cambiar la escala de radios de Tailwind toca a la vez 242 sitios que hoy dibujan esquinas de 24 px donde quien las escribió esperaba 8. No es peligroso, pero no se puede hacer a ciegas.',
  },
}

/* ------------------------------------------------------------------ */
/* Adaptador: CLARO                                                    */
/* ------------------------------------------------------------------ */

const claro: Propuesta = {
  id: 'claro',
  nombre: 'Claro y nítido',
  lema: 'Fondo papel, tinta oscura y el naranja partido en dos usos',
  idea: CLARO.IDEA,
  modoPrincipal: 'claro',
  porQueEseModo: [
    'Es el modo que hoy está roto y sin resolver: glass-card no tiene traducción (1,09:1), la barra lateral tampoco (1,00:1) y el ítem activo del menú da 2,43:1, o sea que en claro no se lee en qué módulo estás. Diseñar primero el caso difícil obliga a que el acento y los estados funcionen.',
    'El papel es cálido (#F2EEE7), no blanco puro: el blanco a pantalla completa y a ocho horas es un foco.',
    'El oscuro está declarado entero y por separado, con sus propios valores. No es una capa de traducción de clases.',
  ],
  tipografia: CLARO.TIPOGRAFIA.map((t) => ({ nombre: t.nombre, px: t.px, grosor: t.grosor, para: t.para })),
  tipografiaNota:
    'Cinco tamaños y tres grosores, contra los 28 tamaños en dos sistemas paralelos y los 6 pesos de Inter (dos de ellos sin usar) de hoy. Tres niveles de tinta: ni uno más, porque no caben cuatro grises distinguibles.',
  paleta: CLARO.PALETA.map((t) => ({ rol: t.nombre, claro: t.claro, oscuro: t.oscuro, para: t.para })),
  contrastes: CLARO.CONTRASTES.map((c) => ({
    par: c.par,
    claro: c.claro,
    oscuro: c.oscuro,
    umbral: c.umbral,
    hoyClaro: c.hoyClaro,
    hoyOscuro: c.hoyOscuro,
  })),
  contrasteMinimo: {
    claro: Math.min(...CLARO.CONTRASTES.filter((c) => c.umbral >= 4.5).map((c) => c.claro)),
    oscuro: Math.min(...CLARO.CONTRASTES.filter((c) => c.umbral >= 4.5).map((c) => c.oscuro)),
  },
  nivelesDeTexto: CLARO.NIVELES_TINTA.length,
  tamanosDeLetra: CLARO.TIPOGRAFIA.length,
  densidad: CLARO.FILAS_COLD_CALLING.map((f) => ({
    viewport: f.viewport,
    contexto: f.equivale,
    hoy: f.hoy,
    propuesta: f.propuesta,
  })),
  alturaFila: { hoy: CLARO.MEDIDO_EN_NAVEGADOR.altoFilaHoy, propuesta: CLARO.MEDIDO_EN_NAVEGADOR.altoFila },
  cromo: { hoy: CLARO.MEDIDO_EN_NAVEGADOR.cromoHoy, propuesta: CLARO.MEDIDO_EN_NAVEGADOR.cromoColdCalling },
  acento: {
    si: [
      'El raíl de 3 px del módulo activo del menú, con su etiqueta y su fondo lavado.',
      'El botón principal de la pantalla. Uno por pantalla.',
      'El anillo de foco: el único sitio donde no compite con nada.',
      'El contador vivo del menú (los leads web sin abrir).',
      'Un solo indicador de la cabecera: el que pide acción hoy.',
      'El borde izquierdo de las tarjetas de «lo que hay que atender» en Inicio.',
      'El nombre de la fila seleccionada de una tabla.',
    ],
    no: [
      'Los 18 iconos de la rejilla de inicio, todos idénticos.',
      'El chip de filtro encendido: un filtro es un estado tuyo, no un aviso.',
      'El tinte de la fila seleccionada, que hoy compite con «En seguimiento» y con el chip activo.',
      'Los títulos de sección, los hover y los bordes decorativos.',
    ],
    resumen:
      'El naranja se parte en dos tokens con reglas distintas: #FF6600 INTACTO como relleno, siempre con etiqueta oscura encima (6,26:1); y #A84300 cuando el naranja tiene que ser texto o icono sobre claro (mismo tono de 24°, misma saturación, otra luminosidad). De 723 apariciones literales se pasa a unas pocas por pantalla.',
  },
  ganas: CLARO.GANAS,
  pierdes: CLARO.PIERDES,
  comoSeMidio:
    'Ratios calculados aplicando WCAG 2.1 a los pares reales de la paleta, tomando el PEOR caso de las cuatro superficies de cada modo (papel, lienzo, papel2 y fila seleccionada). Alturas de fila y cromo medidos en navegador contra el marcado de sus propios componentes.',
  adopcion: {
    fuente:
      'Lectura del comparador. El README de la propuesta dice cuál es el trabajo («reescribir 3.118 declaraciones de color de texto y 720 de naranja») y por dónde empezar («centralizar los cinco shared.ts conservando sus nombres»), pero no lo ordena en pasos.',
    ficheros: [
      { que: 'app/globals.css: los dos modos declarados enteros, y fuera la capa de traducción de 140 líneas', cuantos: '1 fichero, ~140 líneas menos' },
      { que: 'El interruptor de tema: hoy el modo por defecto es el oscuro y aquí pasa a ser el claro', cuantos: '1 fichero (y una decisión de equipo)' },
      { que: 'Los cinco shared.ts, centralizados conservando los nombres', cuantos: '5 → 1' },
      { que: 'Armazón: barra superior nueva de 48 px con el buscador que hoy no existe, menú y rejilla de inicio', cuantos: '3-4 ficheros' },
      { que: 'Los text-white/XX: aquí hay que decidir cuál de los tres niveles de tinta es cada uno', cuantos: '2.207 usos en 176 ficheros' },
      { que: 'Los #FF6600: hay que decidir si cada uno es relleno o es texto', cuantos: '723 usos en 123 ficheros' },
    ],
    porPartes: true,
    pasos: [
      {
        titulo: '1 · Los tokens y los dos modos',
        que: 'Un fichero de tokens con los tres niveles de tinta y los dos naranjas, y globals.css con los dos modos declarados enteros. La capa de traducción se retira aquí, no antes.',
      },
      {
        titulo: '2 · El botón y la cabecera de tabla',
        que: 'Etiqueta oscura sobre el relleno naranja (2,94 → 6,26) y cabecera de columna al nivel de tinta 3 (4,05 → 4,82). Son dos cambios en dos sitios y arreglan 192 y 251 usos.',
      },
      {
        titulo: '3 · Cambiar el modo por defecto a claro',
        que: 'Se puede hacer el día que los dos modos estén completos, y se puede deshacer con un interruptor. Es el paso que hay que probar con el equipo antes de fijarlo.',
      },
      {
        titulo: '4 · Las tablas y la rejilla de inicio',
        que: 'La fila de 32 px con el dato a 13, el lanzador de 38 px por módulo y la barra superior con el buscador.',
      },
    ],
    aviso:
      'Es la única de las tres que cambia la POLARIDAD por defecto del ERP. Cambiar de estética y de polaridad el mismo día son dos cambios a la vez, y el equipo va a notar el segundo más que el primero. ' +
      'Y una advertencia para elegir bien: esta propuesta y la estructurada COMPARTEN la estrategia de color —las dos son claras, las dos tienen tres niveles de texto, las dos llevan barra superior de 48 px, las dos sustituyen las cuatro tarjetas por una tira de cifras y las dos parten el naranja igual (relleno intacto con etiqueta oscura, y un naranja de texto oscurecido: #A84300 aquí, #B34700 allí, dos décimas de diferencia)—. Lo que de verdad las separa es la temperatura del papel (cálido contra frío), la fila (32 contra 28) y una cosa que no es estética: que la estructurada rehace la navegación entera. Elegir entre estas dos no es elegir un color.',
  },
}

/* ------------------------------------------------------------------ */
/* Adaptador: ESTRUCTURADO                                             */
/* ------------------------------------------------------------------ */

const estructurado: Propuesta = {
  id: 'estructurado',
  nombre: 'Estructurado por contexto',
  lema: 'El cliente deja de ser un filtro y pasa a ser el contexto del ERP',
  idea: ESTRUCTURADO.IDEA,
  modoPrincipal: 'claro',
  porQueEseModo: ESTRUCTURADO.POR_QUE_CLARO,
  tipografia: ESTRUCTURADO.ESCALA.map((n) => ({
    nombre: n.nivel.replace('ctx-', ''),
    px: n.px,
    grosor: n.grosor,
    para: n.para,
  })),
  tipografiaNota: `${ESTRUCTURADO.TIPOGRAFIA_ANTES_DESPUES.tamanos.nota} Interlineado: ${ESTRUCTURADO.TIPOGRAFIA_ANTES_DESPUES.interlineado.propuesta}, contra el ${ESTRUCTURADO.TIPOGRAFIA_ANTES_DESPUES.interlineado.hoy}.`,
  paleta: ESTRUCTURADO.PALETA.map((t) => ({ rol: t.rol, claro: t.claro, oscuro: t.oscuro, para: t.para })),
  contrastes: ESTRUCTURADO.CONTRASTE.map((c) => ({
    par: c.par,
    claro: c.claro,
    oscuro: c.oscuro,
    umbral: c.umbral,
    donde: c.donde,
  })),
  contrasteMinimo: {
    claro: ESTRUCTURADO.RECUENTO_CONTRASTE.propuesta.minimo,
    oscuro: Math.min(...ESTRUCTURADO.CONTRASTE.filter((c) => c.umbral >= 4.5).map((c) => c.oscuro)),
  },
  nivelesDeTexto: ESTRUCTURADO.RECUENTO_CONTRASTE.propuesta.nivelesDeTexto,
  tamanosDeLetra: ESTRUCTURADO.ESCALA.length,
  densidad: ESTRUCTURADO.DENSIDAD_MEDIDA.tabla.map((f) => ({
    viewport: f.alto,
    contexto: f.que,
    hoy: f.coldHoy,
    propuesta: f.normal,
  })),
  alturaFila: {
    hoy: ESTRUCTURADO.DENSIDAD_MEDIDA.alturaFila.hoyColdCalling,
    propuesta: ESTRUCTURADO.DENSIDAD_MEDIDA.alturaFila.normal,
  },
  cromo: {
    hoy: ESTRUCTURADO.DENSIDAD_MEDIDA.cromoHoy.coldCalling.cromo,
    propuesta: ESTRUCTURADO.DENSIDAD_MEDIDA.cromoPropuesta,
  },
  acento: {
    si: ESTRUCTURADO.NARANJA.si,
    no: ESTRUCTURADO.NARANJA.no,
    resumen: `${ESTRUCTURADO.NARANJA.cuenta.nota} Portada: ${ESTRUCTURADO.NARANJA.cuenta.portadaPropuesta} elementos naranjas frente a ${ESTRUCTURADO.NARANJA.cuenta.portadaHoy} de hoy; Cold Calling, ${ESTRUCTURADO.NARANJA.cuenta.coldCallingPropuesta}.`,
  },
  ganas: ESTRUCTURADO.GANO,
  pierdes: ESTRUCTURADO.PIERDO,
  comoSeMidio:
    'Ratios calculados con la fórmula de luminancia relativa de WCAG 2.1 sobre los colores finales compuestos. El cálculo de filas por pantalla sale de un presupuesto de píxeles pieza por pieza (metricas.ts), comprobado después en navegador contra el CSS real.',
  adopcion: {
    fuente: 'El plan por pasos es de la propuesta (MEMORIA.ts → PASOS). Los recuentos de ficheros están contados sobre el repositorio.',
    ficheros: [
      { que: 'Un componente nuevo de barra superior con el selector de cuenta, más el contexto de React que lo comparte', cuantos: '2 ficheros nuevos' },
      { que: 'Los tres módulos que ya tienen tira de clientes (Amazon API, stock-sync, marketing), que pasan a leer del contexto', cuantos: '3 ficheros, ~3 líneas cada uno' },
      { que: 'lib/config/apps.ts: de una lista plana de 18 a tres espacios, y AppSidebar.tsx', cuantos: '2 ficheros' },
      { que: 'Los cinco shared.ts, centralizados conservando los nombres', cuantos: '5 → 1' },
      { que: 'Las dos tablas largas y la portada', cuantos: '3 componentes' },
      { que: 'Los text-white/XX, uno a uno: hay que decidir cuál de los tres niveles es cada uno', cuantos: '2.207 usos en 176 ficheros' },
    ],
    porPartes: true,
    pasos: ESTRUCTURADO.PASOS.map((p) => ({
      titulo: `${p.paso} · ${p.titulo}`,
      que: `${p.que} · Coste: ${p.coste} · Se nota: ${p.seNota}`,
    })),
    aviso:
      'Es la más cara de las tres y la única que mueve el armazón, el menú y el modelo mental: no es un cambio de CSS. A cambio, su paso 1 —solo la barra superior con el selector de cuenta, sin mover ni un módulo— entrega, según la propia propuesta, el 70 % de su valor. ' +
      'Para elegir bien: en lo ESTÉTICO esta propuesta y la clara son casi la misma —modo claro las dos, tres niveles de texto las dos, barra de 48 px las dos, tira de cifras en vez de tarjetas las dos, y el mismo reparto del naranja con dos décimas de diferencia en el hex—. Lo que las separa de verdad es la navegación, que solo rehace esta, y la temperatura del papel. La pregunta no es «cuál de los dos claros me gusta más», es «¿queremos además rehacer el menú?».',
  },
}

/* ------------------------------------------------------------------ */
/* La referencia: cómo está HOY                                        */
/* ------------------------------------------------------------------ */

/**
 * Esto no es una propuesta y por eso no tiene «ganas / pierdes» sino «lo que
 * funciona / lo que falla». Los números salen del informe de diagnóstico, que
 * está medido sobre este repositorio en el commit 3fc2c81 y con los contrastes
 * calculados componiendo el alfa contra la superficie real, no sobre el color
 * nominal.
 */
export const HOY: Propuesta = {
  id: 'hoy',
  nombre: 'Como está hoy',
  lema: 'La referencia: el ERP tal y como se ve ahora mismo',
  idea:
    'No hay una idea: hay dieciséis niveles de gris que salieron solos, dos sistemas de botón que conviven en la misma pantalla y un naranja de acento repetido 723 veces. La jerarquía visual no está diseñada, ha ocurrido.',
  modoPrincipal: 'oscuro',
  porQueEseModo: [
    'El oscuro es el que se sirve por defecto y el único que está diseñado.',
    'El claro no es un tema: son 140 líneas al final de app/globals.css que REINTERPRETAN las clases de Tailwind cuando html.light está puesto. Un text-white/70 no se toca en el componente; simplemente deja de ser blanco al 70 %.',
    'Esa capa arregló mucho —y está bien razonada, con los ratios apuntados en el propio CSS—, pero deja fuera lo que no está en su tabla: glass-card (191 usos en 54 ficheros) se queda en blanco puro sobre blanco, la barra lateral se queda sin fondo, y text-white/15 sigue siendo blanco.',
  ],
  tipografia: [
    { nombre: 'heading-medium', px: 36, grosor: 700, para: 'El h1 de casi todas las pantallas. 54 usos. Consume 76-79 px verticales de cada pantalla.' },
    { nombre: 'text-sm', px: 14, grosor: 400, para: 'El tamaño más usado de la escala nombrada: 571 usos. Módulos antiguos.' },
    { nombre: 'text-xs', px: 12, grosor: 400, para: '550 usos. Módulos antiguos.' },
    { nombre: 'text-[11px]', px: 11, grosor: 400, para: '308 usos. Módulos nuevos: la frontera es cronológica, no semántica.' },
    { nombre: 'text-[10px]', px: 10, grosor: 600, para: '258 usos. La cabecera de columna y la etiqueta de campo, en mayúsculas con tracking: el texto más pequeño y el de menos contraste del ERP.' },
    { nombre: 'text-[9px] / [8px]', px: 9, grosor: 400, para: '25 y 5 usos. La píldora de lista de Cold Calling.' },
  ],
  tipografiaNota:
    '28 tamaños distintos en dos sistemas paralelos que conviven en la misma pantalla, y 6 grosores de Inter descargados de los que 2 (300 y 800) no se usan nunca. 236 usos de uppercase, casi siempre con tracking-wider. El 96 % del texto hereda line-height 1,5, incluidas las celdas de 10 px.',
  paleta: [
    { rol: 'página', claro: '#F5F5F7', oscuro: '#080808', para: 'El fondo, con una niebla animada encima: gradientes con blur(120px) y una animación infinita de 25 s.' },
    { rol: 'tarjeta / tabla', claro: '#F0F0F2', oscuro: '#0D0D0D', para: 'bg-white/[0.02] compuesto. Donde vive el trabajo diario.' },
    { rol: 'glass-card', claro: '#FFFFFF', oscuro: '#0E0E0E', para: '191 usos en 54 ficheros. En claro NO tiene traducción: blanco puro sobre #F5F5F7, 1,09:1, con el borde a 1,01:1.' },
    { rol: 'text-white', claro: '#101014', oscuro: '#FFFFFF', para: '939 usos a secas.' },
    { rol: 'text-white/70', claro: '#55555f', oscuro: 'rgba(255,255,255,.7)', para: '572 usos. El nivel más usado de los dieciséis.' },
    { rol: 'text-white/50', claro: '#5f5f6a', oscuro: 'rgba(255,255,255,.5)', para: '347 usos.' },
    { rol: 'text-white/40', claro: '#74747e', oscuro: 'rgba(255,255,255,.4)', para: '251 usos. LA CABECERA DE TODAS LAS TABLAS. 3,80:1 y 4,05:1.' },
    { rol: 'text-white/35', claro: '#74747e', oscuro: 'rgba(255,255,255,.35)', para: '129 usos. Las ~50 etiquetas y notas del perfil de stock. 3,17:1.' },
    { rol: 'text-white/30', claro: '#9a9aa4', oscuro: 'rgba(255,255,255,.3)', para: '142 usos. El precio de un listing FBA que no se puede editar: 2,63:1.' },
    { rol: 'text-white/20', claro: '#9a9aa4', oscuro: 'rgba(255,255,255,.2)', para: '63 usos. El guion de «no hay dato»: 1,80:1.' },
    { rol: 'text-white/15', claro: '#FFFFFF', oscuro: 'rgba(255,255,255,.15)', para: '2 usos, y NO está en la tabla de traducción: en tema claro es blanco sobre blanco.' },
    { rol: '#FF6600', claro: '#FF6600', oscuro: '#FF6600', para: '723 apariciones literales en 123 ficheros. Como TEXTO sobre claro da 2,70:1 en el fondo de página y 2,94:1 sobre blanco: no pasa ni el umbral de texto grande.' },
    { rol: 'blanco sobre #FF6600', claro: '#FFFFFF', oscuro: '#FFFFFF', para: 'La etiqueta del botón principal: 2,94:1 en los DOS temas. 192 instancias.' },
  ],
  contrastes: [
    { par: 'text-white sobre la tarjeta estándar', claro: 16.62, oscuro: 19.44, umbral: 4.5, donde: '939 usos' },
    { par: 'text-white/70', claro: 6.45, oscuro: 9.63, umbral: 4.5, donde: '572 usos' },
    { par: 'text-white/50', claro: 5.52, oscuro: 5.34, umbral: 4.5, donde: '347 usos' },
    { par: 'text-white/45', claro: 4.05, oscuro: 4.52, umbral: 4.5, donde: '122 usos. En oscuro pasa por 0,02; en claro suspende.' },
    { par: 'text-white/40 — LA CABECERA DE TODAS LAS TABLAS', claro: 4.05, oscuro: 3.8, umbral: 4.5, donde: '251 usos, a 10 px y en mayúsculas' },
    { par: 'text-white/35 — etiquetas y notas del perfil', claro: 4.05, oscuro: 3.17, umbral: 4.5, donde: '129 usos' },
    { par: 'text-white/30 — precio FBA no editable', claro: 2.44, oscuro: 2.63, umbral: 4.5, donde: '142 usos' },
    { par: 'text-white/25 — marcadores de posición', claro: 2.44, oscuro: 2.18, umbral: 4.5, donde: '95 usos' },
    { par: 'text-white/20 — el guion de «no hay dato»', claro: 2.44, oscuro: 1.8, umbral: 4.5, donde: '63 usos' },
    { par: 'text-white/15', claro: 1.02, oscuro: 1.5, umbral: 4.5, donde: '2 usos, sin traducción a claro' },
    { par: 'blanco sobre el botón #FF6600', claro: 2.94, oscuro: 2.94, umbral: 4.5, donde: '192 instancias, el botón principal del ERP' },
    { par: '#FF6600 sobre su píldora — el módulo activo del menú', claro: 2.43, oscuro: 6.62, umbral: 4.5, donde: 'En tema claro no se lee en qué módulo estás' },
    { par: 'glass-card sobre la página', claro: 1.09, oscuro: 1.87, umbral: 3, donde: '191 usos: en claro, 54 ficheros de tarjetas sin superficie' },
    { par: 'Estado verde / ámbar / rojo sobre su píldora', claro: 3.78, oscuro: 10.01, umbral: 4.5, donde: 'En claro tres de los cuatro estados se quedan entre 3,78 y 4,42' },
  ],
  contrasteMinimo: { claro: 1.02, oscuro: 1.5 },
  nivelesDeTexto: 16,
  tamanosDeLetra: 28,
  densidad: [
    { viewport: 1080, contexto: 'monitor 1080 a pantalla completa', hoy: 19, propuesta: 19 },
    { viewport: 940, contexto: 'monitor 1920×1080 con Chrome y la barra de macOS', hoy: 15, propuesta: 15 },
    { viewport: 780, contexto: 'portátil 1440×900 con Chrome', hoy: 10, propuesta: 10 },
  ],
  alturaFila: { hoy: 35.5, propuesta: 35.5 },
  cromo: { hoy: 396.5, propuesta: 396.5 },
  acento: {
    si: ['No hay regla escrita. El naranja está en los 18 módulos, sin excepción.'],
    no: [
      'No hay ningún sitio donde esté decidido que NO va. Los 18 iconos de la rejilla de inicio son idénticos, y el código explica por qué: antes el color salía de app.status, pero como a cada módulo nuevo se le pone «new» y nadie se lo quita, media rejilla acababa en gris sin significar nada. La solución fue quitar el significado, no arreglarlo.',
    ],
    resumen:
      '723 apariciones literales de #FF6600 en 123 ficheros. No hay un solo módulo sin él: LinkedIn 74, Comisiones 64, Clientes 56, Agenda 45, Tracker 44… Un acento que sale 723 veces no acentúa nada.',
  },
  ganas: [
    'tabular-nums en todo número: 177 usos. Los SKU, los EAN, los importes y las horas alinean en columna. Sin eso no se puede comparar celda a celda contra el Excel del cliente.',
    'La cadena de tres min-w-0 que mantiene el scroll horizontal DENTRO de la tabla, documentada en tres sitios. Sin los tres, doce columnas arrastran la página de lado y se llevan la barra lateral por delante.',
    'El fondo OPACO de las celdas congeladas, por variable y no por hex, y la escalera de z-index: esquina 30 · cabecera 20 · primera columna 10 · resto 0.',
    '«Ver más (N restantes)» en vez de virtualizar, para que Ctrl+F, el scroll y la impresión se comporten igual en todas las tablas.',
    'La celda que no parece un campo hasta que pasas por encima: es lo único que impide que doce columnas editables se lean como un formulario.',
    'Guardar al salir del campo, sin botón, en los formularios largos. Y enseñar el valor anterior al lado del nuevo, tachado, con deshacer por celda.',
    'Nada viaja hasta que se pulsa «Enviar cambios», y entonces se enseña la lista completa antes.',
    'Los estados SIEMPRE llevan palabra en español, nunca solo color, y hay mapas de pistas («No coge, buzón o cuelga: hay que reintentar»).',
    'Los colores del Excel se conservaron a propósito para que el equipo no reaprenda nada.',
    'simulacro en gris y NO en verde: es el estado de un cliente que no está mandando nada.',
    'Los filtros se recuerdan por usuario, con la clave por usuario por si comparten ordenador, y hay un botón «Limpiar filtros» visible.',
    'Formato español en todo: fechas, importes, zona horaria y «hace 4 minutos».',
    'El vocabulario de tokens de los cinco shared.ts ya existe, funciona y el equipo lo usa. Los nombres son buenos.',
  ],
  pierdes: [
    '2.207 usos de text-white/XX en DIECISÉIS niveles de opacidad. En oscuro fallan 682 (31 %); en claro, 804 (37 %), porque la capa de traducción colapsa /45, /40 y /35 en un solo color y /30, /25 y /20 en otro.',
    'La cabecera de TODAS las tablas del ERP va a 3,80:1 en oscuro y 4,05:1 en claro, a 10 px y en mayúsculas.',
    'Las ~50 etiquetas y las notas del perfil de stock —que son lo que hace esa pantalla usable— van a 3,17:1.',
    'El botón principal del ERP tiene el texto a 2,94:1 en los dos temas. Son 192 instancias.',
    'En tema claro no se lee en qué módulo estás: el ítem activo del menú da 2,43:1.',
    'glass-card no tiene traducción a claro: 191 usos en 54 ficheros se quedan sin superficie y sin borde.',
    'Dos sistemas de botón conviviendo a 20 px de distancia con 16 px de diferencia de altura y tratamientos tipográficos opuestos.',
    'La barra lateral mide 1.049 px con los 18 módulos: por debajo de esa altura scrollea sola. En un portátil se ven once de dieciocho.',
    '396,5 px de cromo por encima de la tabla de Cold Calling y 525 en el catálogo. Un comercial en un portátil ve 10 leads de casi 4.000.',
    'La niebla animada de 25 s con blur(120px) está en todas las pantallas y en las ocho horas: dos celdas idénticas no tienen el mismo contraste según dónde caigan ni según el segundo.',
    'Un freno apagado se distingue de uno puesto solo por si el hueco tiene número o un marcador de posición gris.',
    'El punto de color de 6 y 8 px es el único canal de algunos estados, y el tinte de fila al 8 % de alfa junta tres hues distintos en el mismo beige con deuteranopía.',
  ],
  comoSeMidio:
    'Informe de diagnóstico sobre este repositorio en el commit 3fc2c81: contrastes calculados componiendo el alfa contra la superficie real (no sobre el color nominal) y alturas de fila medidas en navegador contra una réplica byte a byte del marcado, no estimadas.',
  adopcion: {
    fuente: 'No aplica: es lo que ya está desplegado.',
    ficheros: [],
    porPartes: false,
    pasos: [],
  },
}

export const PROPUESTAS: Propuesta[] = [HOY, denso, claro, estructurado]

export function propuestaPorId(id: IdPropuesta): Propuesta {
  return PROPUESTAS.find((p) => p.id === id) ?? HOY
}

/* ------------------------------------------------------------------ */
/* Las tres pantallas del diagnóstico                                  */
/* ------------------------------------------------------------------ */

export type IdPantalla = 'inicio' | 'cold' | 'perfil'

export const PANTALLAS: { id: IdPantalla; nombre: string; ruta: string; porQue: string; queResolver: string }[] = [
  {
    id: 'inicio',
    nombre: 'Inicio',
    ruta: '/dashboard',
    porQue:
      'Es la única pantalla que ven las cinco personas todos los días, varias veces al día, porque no hay buscador global: para cambiar de módulo, o entras por la barra lateral o pasas por aquí.',
    queResolver:
      '18 objetos con el mismo peso; 202 px de tarjeta para tres líneas de texto; el icono naranja repetido 18 veces; la insignia de leads sin leer es la única información viva de la pantalla y compite en igualdad con «Usos horarios»; y en tema claro las 18 tarjetas pierden el borde.',
  },
  {
    id: 'cold',
    nombre: 'Cold Calling',
    ruta: '/dashboard/cold-calling',
    porQue:
      'La tabla más dura del ERP y la que más horas acumula: dos comerciales a jornada completa, 12 columnas, seis editables en línea, siete estados y casi 4.000 filas. Si un diseño funciona aquí, funciona en el catálogo.',
    queResolver:
      '35,5 px por fila y 396,5 px de cromo para ver 10-19 filas de casi 4.000; siete hues al 8 % de alfa como código de estado; la cabecera de columna a 3,80:1; el naranja de la fila seleccionada compitiendo con el de «En seguimiento» y con el del chip activo; y seis columnas editables que no deben parecer un formulario.',
  },
  {
    id: 'perfil',
    nombre: 'Perfil de stock',
    ruta: '/dashboard/amazon-api → Automatización',
    porQue:
      'La pantalla más densa en formulario del ERP y la que más estados tiene que comunicar a la vez. Sin botón de guardar, y equivocarse tiene consecuencia real: desde aquí se escribe stock y precio en las tiendas de los clientes.',
    queResolver:
      '~50 campos con etiquetas y notas a 3,17:1 que son justo lo que hace la pantalla usable; la diferencia entre «este freno está en 30 %» y «este freno está apagado» dicha solo con un marcador de posición gris; sin botón de guardar y por tanto sin confirmación de que lo tecleado ha quedado escrito; y cinco estados de ejecución donde dos comparten color a propósito.',
  },
]

/* ------------------------------------------------------------------ */
/* La tabla comparativa                                                */
/* ------------------------------------------------------------------ */

export interface FilaComparativa {
  criterio: string
  detalle: string
  hoy: string
  denso: string
  claro: string
  estructurado: string
  /** true cuando el valor de «hoy» es el que hay que arreglar */
  hoyFalla?: boolean
}

/**
 * Los cinco números del diagnóstico, uno por criterio, más los que hacen falta
 * para decidir. Se calculan desde las memorias de cada propuesta salvo la
 * columna «hoy», que sale del informe y de contar sobre el repositorio.
 */
export const COMPARATIVA: FilaComparativa[] = [
  {
    criterio: 'Niveles de texto',
    detalle: 'Cuántos grises distintos hay que distinguir. Nadie distingue dieciséis.',
    hoy: '16 niveles · 2.207 usos',
    denso: `${denso.nivelesDeTexto} niveles`,
    claro: `${claro.nivelesDeTexto} niveles`,
    estructurado: `${estructurado.nivelesDeTexto} niveles`,
    hoyFalla: true,
  },
  {
    criterio: 'Tamaños de letra',
    detalle: 'Hoy conviven dos sistemas: text-sm/text-xs en los módulos viejos y text-[11px]/[10px] en los nuevos.',
    hoy: '28 tamaños',
    denso: `${denso.tamanosDeLetra} tamaños`,
    claro: `${claro.tamanosDeLetra} tamaños`,
    estructurado: `${estructurado.tamanosDeLetra} tamaños`,
    hoyFalla: true,
  },
  {
    criterio: 'Peor contraste de texto · oscuro',
    detalle: 'Umbral WCAG para texto normal: 4,5:1.',
    hoy: '1,50:1 (text-white/15) · la cabecera de tabla, 3,80',
    denso: `${denso.contrasteMinimo.oscuro.toFixed(2).replace('.', ',')}:1`,
    claro: `${claro.contrasteMinimo.oscuro.toFixed(2).replace('.', ',')}:1`,
    estructurado: `${estructurado.contrasteMinimo.oscuro.toFixed(2).replace('.', ',')}:1`,
    hoyFalla: true,
  },
  {
    criterio: 'Peor contraste de texto · claro',
    detalle: 'Mismo umbral. En claro fallan 804 usos, el 37 %.',
    hoy: '1,02:1 (blanco sobre blanco) · la cabecera de tabla, 4,05',
    denso: `${denso.contrasteMinimo.claro.toFixed(2).replace('.', ',')}:1`,
    claro: `${claro.contrasteMinimo.claro.toFixed(2).replace('.', ',')}:1`,
    estructurado: `${estructurado.contrasteMinimo.claro.toFixed(2).replace('.', ',')}:1`,
    hoyFalla: true,
  },
  {
    criterio: 'Usos de texto que suspenden 4,5:1',
    detalle: 'Contados sobre los 2.207 text-white/XX del ERP.',
    hoy: '682 en oscuro (31 %) · 804 en claro (37 %)',
    denso: '0',
    claro: '0',
    estructurado: '0',
    hoyFalla: true,
  },
  {
    criterio: 'Etiqueta del botón principal',
    detalle: '192 instancias. El naranja de marca a plena saturación no admite texto blanco.',
    hoy: '2,94:1 en los dos temas',
    denso: '6,17:1 (tinta oscura)',
    claro: '6,26:1 (tinta oscura)',
    estructurado: '6,31:1 (tinta oscura)',
    hoyFalla: true,
  },
  {
    criterio: 'Altura de fila · Cold Calling',
    detalle: 'Hoy la manda el cromo de la celda editable, no el dato: 6 px de los 35,5.',
    hoy: '35,5 px (dato a 12 px)',
    denso: `${denso.alturaFila.propuesta} px (dato a 12,5)`,
    claro: `${claro.alturaFila.propuesta} px (dato a 13)`,
    estructurado: `${estructurado.alturaFila.propuesta} px (dato a 13) · ajustable 24/28/32`,
    hoyFalla: true,
  },
  {
    criterio: 'Cromo por encima de la tabla',
    detalle: 'Título, indicadores, tres filas de filtros y el pie. Píxeles que nunca son datos.',
    hoy: '396,5 px',
    denso: `${denso.cromo.propuesta} px`,
    claro: `${claro.cromo.propuesta} px`,
    estructurado: `${estructurado.cromo.propuesta} px`,
    hoyFalla: true,
  },
  {
    criterio: 'Filas visibles · monitor 1080',
    detalle: 'Sin hacer scroll, en la tabla de Cold Calling.',
    hoy: '19 filas',
    denso: `${denso.densidad.find((d) => d.viewport === 1080)?.propuesta ?? '—'} filas`,
    claro: `${claro.densidad.find((d) => d.viewport === 1080)?.propuesta ?? '—'} filas`,
    estructurado: `${estructurado.densidad.find((d) => d.viewport === 1080)?.propuesta ?? '—'} filas`,
  },
  {
    criterio: 'Filas visibles · portátil 780',
    detalle: 'La pantalla real de un comercial en Latinoamérica, con casi 4.000 leads que recorrer.',
    hoy: '10 filas',
    denso: `${denso.densidad.find((d) => d.viewport === 780)?.propuesta ?? '—'} filas`,
    claro: `${claro.densidad.find((d) => d.viewport === 780)?.propuesta ?? '—'} filas`,
    estructurado: `${estructurado.densidad.find((d) => d.viewport === 780)?.propuesta ?? '—'} filas`,
    hoyFalla: true,
  },
  {
    criterio: 'Sitios que usan el acento',
    detalle: 'Elementos naranjas visibles a la vez en la pantalla de inicio.',
    hoy: '18 iconos idénticos (723 usos literales en 123 ficheros)',
    denso: '8 marcas',
    claro: 'El raíl del módulo activo y el contador vivo',
    estructurado: '3 elementos',
    hoyFalla: true,
  },
  {
    criterio: 'Módulos visibles en Inicio · 780 px',
    detalle: 'De 18. Hoy cada tarjeta ocupa 202 px de alto para tres líneas de texto.',
    hoy: '8 de 18',
    denso: '18 de 18',
    claro: '17 de 17 (Inicio sale del lanzador)',
    estructurado: 'Los 3 espacios y los 11 módulos del más largo',
    hoyFalla: true,
  },
  {
    criterio: 'Alto de la barra lateral',
    detalle: 'Con los 18 módulos. Por encima del alto de la ventana, scrollea sola.',
    hoy: '1.049 px · en un portátil se ven 11 de 18',
    denso: '670 px',
    claro: '522 px',
    estructurado: '2 niveles: carril de 132 px + como mucho 11 módulos',
    hoyFalla: true,
  },
  {
    criterio: 'Modo principal',
    detalle: 'Cada propuesta defiende uno distinto, y las tres declaran el otro entero (no traducido).',
    hoy: 'Oscuro · el claro es una capa de traducción de 140 líneas',
    denso: 'Oscuro',
    claro: 'Claro',
    estructurado: 'Claro',
  },
  {
    criterio: 'Estrategia del naranja',
    detalle:
      'Las TRES hacen lo mismo: relleno #FF6600 intacto con etiqueta oscura encima, y un naranja oscurecido cuando el acento tiene que ser texto o un filo. Cambia el hex del segundo, no la idea. Esto NO es un desempate.',
    hoy: 'Sin regla: 723 usos y blanco encima del naranja',
    denso: 'Relleno #FF6600 + tinta #14161A · texto #B84900',
    claro: 'Relleno #FF6600 + tinta #17140F · texto #A84300',
    estructurado: 'Relleno #FF6600 + tinta #1A1206 · texto #B34700',
    hoyFalla: true,
  },
  {
    criterio: 'Qué mueve',
    detalle:
      'Lo que hay que tocar para adoptarla, y lo que de verdad separa a las tres. Denso y clara son la MISMA jugada estructural con distinta temperatura y distinta polaridad; la estructurada es la única que cambia algo que no es la capa visual.',
    hoy: '—',
    denso: 'Solo la capa visual: tokens y densidad. Misma navegación.',
    claro: 'Solo la capa visual: tokens, densidad y la polaridad por defecto. Misma navegación.',
    estructurado: 'También la NAVEGACIÓN: 3 espacios, 2 niveles y selector de cuenta permanente.',
  },
  {
    criterio: 'Temperatura del papel',
    detalle:
      'Entre las dos propuestas de tema claro, esto y la altura de fila es lo único estético que las separa. Conviene mirarlas seguidas con la tecla X.',
    hoy: 'Frío (#F5F5F7), y sin resolver',
    denso: 'No aplica: su modo principal es el oscuro',
    claro: 'Cálido (#F2EEE7 lienzo, #FFFFFF papel)',
    estructurado: 'Frío (#EFF1F4 fondo, #FFFFFF superficie)',
  },
]
