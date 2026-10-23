import { ejemplosParaLead, mencionaFacturacion, quitarFrasesConDinero, sinDatosDeContacto, unirLineasPartidas, type EjemploGanador } from './ia-ejemplos'
import type { SeccionesDeInstrucciones } from './ia-prompt'

/**
 * LAS VERSIONES DE LA IA: QUÉ INSTRUCCIONES Y QUÉ EJEMPLOS USA CADA CORREO, Y CUÁL SE ELIGE.
 * ==========================================================================================
 * PURO: no toca la base ni la red. Se comprueba con ia-version.prueba.ts.
 *
 * Quien supervisa al equipo (Jhanna) quiere encontrar el correo que más convierte. Para saberlo no basta con opinar: hay que enviar versiones
 * distintas a leads parecidos y mirar cuál recibe más respuestas. Una VERSIÓN es un juego completo —las instrucciones, los ejemplos que se le
 * enseñan, si además aprende de los correos del equipo con respuesta y, si se quiere, el modelo— con un PESO: cada vez que un comercial pide un
 * borrador se SORTEA entre las versiones que están en marcha, en proporción a su peso, y el borrador queda apuntado con la versión que lo escribió
 * (correo_ia_borradores.version_id). Al enviarse, lo que conteste el cliente cuenta para esa versión (lib/correo/ia-resultados.ts).
 *
 * El comercial NO elige ni ve la versión: si pudiera, escogería la que le gusta y la comparación dejaría de valer. Mientras redacta de nuevo
 * un mismo correo («Volver a redactar») se mantiene la versión del primer borrador, por lo mismo.
 *
 * UNA VERSIÓN YA USADA NO SE EDITA (se duplica y se edita la copia): si se cambiara el texto a mitad, las respuestas de antes y de después
 * se mezclarían bajo el mismo nombre y los resultados no dirían nada.
 */

export interface VersionDeIa {
  id: string
  nombre: string
  notas: string | null
  secciones: SeccionesDeInstrucciones
  /** Los ejemplos propios (de Mis ejemplos) que se le enseñan a la IA con esta versión */
  ejemplosIds: string[]
  /** Además de los propios, aprende de los correos del equipo que consiguieron respuesta */
  usarGanadores: boolean
  /** null = el modelo de siempre */
  modelo: string | null
  /** 0-100. El reparto es proporcional entre las versiones en marcha */
  peso: number
  activa: boolean
  /** La versión original: la de siempre. No se edita ni se borra, es el punto de comparación */
  esBase: boolean
  archivada: boolean
}

export interface EjemploPropio {
  id: string
  titulo: string
  asunto: string
  texto: string
  tipo: 'entrar' | 'optimizar' | 'ambos'
  nota: string | null
  activo: boolean
}

/* ------------------------------------------------------------------ */
/* El sorteo                                                           */
/* ------------------------------------------------------------------ */

/** ¿Entra en el sorteo? En marcha, no archivada y con peso */
export const enSorteo = (v: Pick<VersionDeIa, 'activa' | 'archivada' | 'peso'>): boolean => v.activa && !v.archivada && v.peso > 0

/**
 * Sortea una versión en proporción a su peso. `azar` es un número en [0, 1) (Math.random() en producción: se pasa para poder probarlo).
 * Devuelve null si ninguna está en marcha: quien llama usa entonces la original de siempre.
 */
export function elegirVersion<T extends Pick<VersionDeIa, 'activa' | 'archivada' | 'peso'>>(versiones: readonly T[], azar: number): T | null {
  const bolsa = versiones.filter(enSorteo)
  const total = bolsa.reduce((suma, v) => suma + v.peso, 0)
  if (total <= 0) return null
  const punto = Math.min(Math.max(azar, 0), 0.999999999) * total
  let acumulado = 0
  for (const v of bolsa) {
    acumulado += v.peso
    if (punto < acumulado) return v
  }
  return bolsa[bolsa.length - 1]
}

/**
 * La versión de un borrador. Si el cuadro de correo ya tenía una (se está redactando de nuevo el mismo correo) se mantiene aunque ya no esté en
 * el sorteo —salvo que se haya archivado—; si no, se sortea.
 */
export function versionParaBorrador<T extends Pick<VersionDeIa, 'id' | 'activa' | 'archivada' | 'peso'>>(versiones: readonly T[], pedida: string | null | undefined, azar: number): T | null {
  if (pedida) {
    const igual = versiones.find((v) => v.id === pedida && !v.archivada)
    if (igual) return igual
  }
  return elegirVersion(versiones, azar)
}

/** El reparto que ve quien configura: cuántos de cada 100 correos usan cada versión en marcha */
export function repartoEnPorcentaje(versiones: readonly Pick<VersionDeIa, 'id' | 'activa' | 'archivada' | 'peso'>[]): Map<string, number> {
  const bolsa = versiones.filter(enSorteo)
  const total = bolsa.reduce((suma, v) => suma + v.peso, 0)
  const salida = new Map<string, number>()
  if (total <= 0) return salida
  for (const v of bolsa) salida.set(v.id, Math.round((100 * v.peso) / total))
  return salida
}

/* ------------------------------------------------------------------ */
/* Lo que se enseña como ejemplo                                       */
/* ------------------------------------------------------------------ */

/**
 * Un ejemplo escrito a mano, listo para la IA: sin correos ni teléfonos, sin las frases que hablan de dinero (la IA las imitaría) y con las
 * líneas partidas unidas. Si tras limpiarlo queda demasiado corto, o el asunto habla de dinero, no sirve y devuelve null.
 */
export function ejemploPropioParaIa(e: Pick<EjemploPropio, 'asunto' | 'texto'>): { asunto: string; texto: string } | null {
  const asunto = e.asunto.replace(/\s+/g, ' ').trim()
  if (asunto === '' || mencionaFacturacion(asunto)) return null
  const { texto } = quitarFrasesConDinero(unirLineasPartidas(sinDatosDeContacto(e.texto.replace(/\r\n?/g, '\n'))))
  if (texto.length < 80 || mencionaFacturacion(texto)) return null
  return { asunto, texto }
}

/**
 * Los ejemplos de ESTE correo: primero los propios que la versión elige (los del mismo tipo de lead delante), y después, si la versión lo
 * pide, los correos del equipo que funcionaron, hasta `max`. Con los propios llenando todos los huecos, los automáticos no entran.
 */
export function montarEjemplos(datos: {
  elegidos: readonly EjemploPropio[]
  ganadores: readonly EjemploGanador[]
  tipo: EjemploGanador['tipo']
  usarGanadores: boolean
  max?: number
}): Array<{ asunto: string; texto: string }> {
  const max = datos.max ?? 4
  const compatible = (e: EjemploPropio) => (e.tipo === 'ambos' || e.tipo === datos.tipo ? 0 : 1)
  const propios = datos.elegidos
    .filter((e) => e.activo)
    .map((e, i) => ({ e, i }))
    .sort((a, b) => compatible(a.e) - compatible(b.e) || a.i - b.i)
    .map(({ e }) => ejemploPropioParaIa(e))
    .filter((e): e is { asunto: string; texto: string } => e !== null)
  const automaticos = datos.usarGanadores ? ejemplosParaLead(datos.ganadores, datos.tipo, max).map((g) => ({ asunto: g.asunto, texto: g.texto })) : []
  return [...propios, ...automaticos].slice(0, max)
}

/* ------------------------------------------------------------------ */
/* Cuánto cuesta un borrador                                           */
/* ------------------------------------------------------------------ */

/**
 * Dólares por millón de tokens (entrada, salida) de los modelos que se pueden elegir en una versión. De rastreadores de terceros (23 oct
 * 2026), NO de la página oficial de OpenAI: sirven para decir «unos 0,9 céntimos», no para facturar.
 */
export const PRECIOS_POR_MILLON: Readonly<Record<string, readonly [number, number]>> = {
  'gpt-5.5': [5, 30],
  'gpt-5.6-sol': [5, 30],
  'gpt-5.6-terra': [2, 12],
  'gpt-5.6-luna': [0.2, 1.2],
  'gpt-5.4-mini': [0.75, 4.5],
  'gpt-5.4-nano': [0.2, 1.25],
  'gpt-5-mini': [0.25, 2],
}

/** Los modelos que ofrece el editor de versiones, del mejor al más barato. El primero es el de siempre */
export const MODELOS_DEL_EDITOR: ReadonlyArray<{ id: string | null; nombre: string }> = [
  { id: null, nombre: 'El de siempre (gpt-5.6-terra)' },
  { id: 'gpt-5.6-sol', nombre: 'gpt-5.6-sol · el más capaz' },
  { id: 'gpt-5.5', nombre: 'gpt-5.5' },
  { id: 'gpt-5.6-luna', nombre: 'gpt-5.6-luna · el más barato' },
]

/** Lo que costó un borrador, en dólares, o null si no se conoce el precio del modelo */
export function costeAproximado(modelo: string, tokens: { entrada: number; salida: number } | null): number | null {
  const p = PRECIOS_POR_MILLON[modelo]
  if (!p || !tokens) return null
  return (tokens.entrada * p[0] + tokens.salida * p[1]) / 1_000_000
}

/* ------------------------------------------------------------------ */
/* Cuánto cambió el comercial lo que escribió la IA                    */
/* ------------------------------------------------------------------ */

const palabras = (t: string): string[] =>
  t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)

/**
 * Cuánto se parecen dos textos, de 0 a 1: la subsecuencia común más larga de PALABRAS, sobre el total. 1 = el comercial lo envió tal cual; 0,6 = cambió
 * casi la mitad. Es la señal más rápida de si una versión escribe lo que el equipo habría escrito: no hace falta esperar a que contesten.
 */
export function similitud(a: string, b: string): number {
  const x = palabras(a)
  const y = palabras(b)
  if (x.length === 0 && y.length === 0) return 1
  if (x.length === 0 || y.length === 0) return 0
  // Dos filas: textos de un correo (unas 150 palabras), no hace falta más
  let previa = new Array<number>(y.length + 1).fill(0)
  let actual = new Array<number>(y.length + 1).fill(0)
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      actual[j] = x[i - 1] === y[j - 1] ? previa[j - 1] + 1 : Math.max(previa[j], actual[j - 1])
    }
    ;[previa, actual] = [actual, previa]
  }
  return (2 * previa[y.length]) / (x.length + y.length)
}

/** Lo contrario, en porcentaje entero: «cambió el 12 %» */
export const cambiosEnPorcentaje = (original: string, final: string): number => Math.round(100 * (1 - similitud(original, final)))

/* ------------------------------------------------------------------ */
/* Lo que llega del editor                                             */
/* ------------------------------------------------------------------ */

export function validarNombreDeVersion(nombre: unknown): { ok: true; nombre: string } | { ok: false; error: string } {
  if (typeof nombre !== 'string') return { ok: false, error: 'Falta el nombre de la versión.' }
  const n = nombre.replace(/\s+/g, ' ').trim()
  if (n === '') return { ok: false, error: 'Ponle un nombre a la versión.' }
  if (n.length > 80) return { ok: false, error: 'El nombre es demasiado largo (máximo 80 caracteres).' }
  return { ok: true, nombre: n }
}

/** El modelo de una versión: vacío = el de siempre. Solo letras, números, puntos y guiones: va tal cual a la API de OpenAI */
export function validarModelo(modelo: unknown): { ok: true; modelo: string | null } | { ok: false; error: string } {
  if (modelo === null || modelo === undefined) return { ok: true, modelo: null }
  if (typeof modelo !== 'string') return { ok: false, error: 'El modelo no es válido.' }
  const m = modelo.trim().toLowerCase()
  if (m === '') return { ok: true, modelo: null }
  if (!/^[a-z0-9][a-z0-9._-]{1,39}$/.test(m)) return { ok: false, error: 'El modelo no es válido.' }
  return { ok: true, modelo: m }
}

export function validarPeso(peso: unknown): { ok: true; peso: number } | { ok: false; error: string } {
  const n = typeof peso === 'number' ? peso : typeof peso === 'string' && peso.trim() !== '' ? Number(peso) : NaN
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 100) return { ok: false, error: 'El peso es un número entero de 0 a 100.' }
  return { ok: true, peso: n }
}

/** Los ejemplos propios: lo que se puede guardar y avisos de lo que la IA va a ignorar */
export function validarEjemplo(entrada: unknown):
  | { ok: true; ejemplo: { titulo: string; asunto: string; texto: string; tipo: EjemploPropio['tipo']; nota: string | null }; avisos: string[] }
  | { ok: false; error: string } {
  if (!entrada || typeof entrada !== 'object') return { ok: false, error: 'Falta el correo de ejemplo.' }
  const o = entrada as Record<string, unknown>
  const limpio = (v: unknown) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim() : '')
  const asunto = limpio(o.asunto).replace(/\s+/g, ' ')
  const texto = limpio(o.texto)
  const titulo = limpio(o.titulo).replace(/\s+/g, ' ') || asunto.slice(0, 60)
  const nota = limpio(o.nota) || null
  const tipo = o.tipo === 'entrar' || o.tipo === 'optimizar' || o.tipo === 'ambos' ? o.tipo : 'ambos'
  if (asunto === '') return { ok: false, error: 'Falta el asunto del correo de ejemplo.' }
  if (asunto.length > 150) return { ok: false, error: 'El asunto es demasiado largo (máximo 150 caracteres).' }
  if (texto.length < 120) return { ok: false, error: 'El texto es demasiado corto para servir de ejemplo (mínimo 120 caracteres).' }
  if (texto.length > 4000) return { ok: false, error: 'El texto es demasiado largo (máximo 4.000 caracteres).' }
  if (titulo.length > 80) return { ok: false, error: 'El título es demasiado largo (máximo 80 caracteres).' }
  if (nota && nota.length > 500) return { ok: false, error: 'La nota es demasiado larga (máximo 500 caracteres).' }

  const avisos: string[] = []
  if (mencionaFacturacion(asunto)) avisos.push('El asunto habla de dinero: la IA no usará este ejemplo.')
  else if (mencionaFacturacion(texto)) avisos.push('El texto habla de facturación o de cifras de dinero: a la IA le llegará sin esas frases.')
  if (/[\[\]]|\{\{/.test(texto)) avisos.push('Tiene huecos entre corchetes o llaves: la IA los podría copiar. Mejor un ejemplo completo.')
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(texto) || /(\+\s?\d{1,3}[\s.-]?)?(\(?\d{2,4}\)?[\s.-]?){2,4}\d{2,4}/.test(texto.replace(/\d{4}/g, ''))) {
    avisos.push('Lleva un correo o un teléfono: a la IA le llegarán tapados.')
  }
  return { ok: true, ejemplo: { titulo, asunto, texto, tipo, nota }, avisos }
}
