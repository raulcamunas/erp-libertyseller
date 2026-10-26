import { diaCorto, diaDeLaSemana } from '@/lib/correo/secuencias/fechas'

/**
 * LO QUE COMPARTEN LAS DOS FORMAS DE PEDIR UNA RELLAMADA: POR CORREO («llámame el jueves») Y POR TELÉFONO (lo dice el cliente en la llamada).
 * ===========================================================================================================================================
 * PURO: no toca la base ni la red. Se comprueba con reglas.prueba.ts. Lo usan la lectura de las respuestas de los leads
 * (lib/correo/secuencias/clasificar.ts) y la lectura de las llamadas transcritas (lib/transcripcion/rellamada.ts).
 *
 * Las dos hacen lo mismo con lo que dice la IA: no se da por bueno sin más. La IA tiene que citar las palabras del cliente copiadas tal cual, y esas
 * palabras tienen que estar de verdad en el correo o en la llamada; el día se vuelve a comprobar con el calendario (si el cliente dijo «el jueves», la
 * fecha tiene que caer en jueves) y se pasa a un día hábil. Lo que no cuadra no se hace: se deja una nota para que lo mire una persona.
 */

/** Hasta cuántos días adelante se acepta la fecha de una rellamada. Más allá se da por un error */
export const MAX_DIAS_DE_RELLAMADA = 400

/** Los estados en que un lead se puede pasar a «No le interesa» o programar sin pisar el trabajo de nadie (nadie lo está llevando) */
export const ESTADOS_QUE_SE_PUEDEN_TOCAR: readonly string[] = ['pendiente', 'no_contesta', 'programado', 'email_enviado']

/**
 * De esos, los que se pasan a «No le interesa» sin mirar nada más (nadie los lleva). «Rellamada programada» queda aparte: solo se cierra si su día ya llegó o no
 * tiene, porque con un día por llegar la rellamada la puso una persona (o el cliente la pidió) y un «no» de otra llamada no la borra.
 */
export const ESTADOS_QUE_SE_CIERRAN_SIN_MAS: readonly string[] = ESTADOS_QUE_SE_PUEDEN_TOCAR.filter((estado) => estado !== 'programado')

/** Cómo se calcula el día que pide el cliente. Va dentro de las instrucciones de la IA, tanto en la de los correos como en la de las llamadas */
export const COMO_SACAR_EL_DIA = `Cómo sacar el día (AAAA-MM-DD), contando desde la fecha de hoy que te doy:
- «mañana» es el día siguiente; «pasado mañana», dos días después; «dentro de N días», hoy más N días.
- Un día de la semana sin más («el jueves», «el próximo jueves») es el primer ese día a partir de mañana. «La semana que viene» sin más es el lunes de la semana siguiente; si añade un día («el martes de la semana que viene»), ese día de la semana siguiente.
- Solo un mes («en enero», «a principios de noviembre»): el día 10 de ese mes. «Dentro de dos semanas»: hoy más 14 días.
- Fiestas y campañas: «después de Reyes», «pasadas las fiestas», «después de Navidad» o «cuando pase la campaña de Navidad», el 7 de enero; «después del verano», el 1 de septiembre; «después de Semana Santa», el martes siguiente al Domingo de Pascua; «después del Black Friday», el 1 de diciembre; «a final de año», el 10 de diciembre; «a final de mes», el 28 de ese mes.
- Si la fecha que sale ya pasó este año, la del año siguiente. Nunca un día anterior a hoy.`

/* ------------------------------------------------------------------ */
/* Comparar frases                                                     */
/* ------------------------------------------------------------------ */

/** Minúsculas, sin tildes y con todo lo que no es letra o número reducido a un espacio: para comparar frases sin que una coma o un acento las diferencie */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim()
}

/**
 * ¿Están las palabras de `frase` en `texto`? Primero tal cual (sin mirar mayúsculas, tildes ni signos). Si no, vale que estén todas, en el mismo orden y
 * en un tramo no mucho más largo que la frase: la IA a veces se salta una muletilla («eh», «pues») al copiar lo que dijo alguien al teléfono.
 */
export function fraseEstaEnElTexto(frase: string, texto: string): boolean {
  const f = normalizar(frase)
  if (f.length < 4) return false
  const t = normalizar(texto)
  if (t.includes(f)) return true

  const palabras = f.split(' ')
  if (palabras.length < 3) return false
  const tokens = t.split(' ')
  const tramoMaximo = palabras.length * 2 + 2
  for (let inicio = 0; inicio < tokens.length; inicio++) {
    if (tokens[inicio] !== palabras[0]) continue
    let siguiente = 1
    for (let i = inicio + 1; i < tokens.length && i - inicio < tramoMaximo && siguiente < palabras.length; i++) {
      if (tokens[i] === palabras[siguiente]) siguiente++
    }
    if (siguiente === palabras.length) return true
  }
  return false
}

/**
 * ¿Dice la frase CUÁNDO? Un día de la semana, una fecha, «mañana», «la semana que viene», «dentro de dos semanas», «después de Reyes»… Las palabras en
 * que se apoya una rellamada tienen que decir cuándo: «perfecto, gracias» puede estar en la llamada, pero no apoya ninguna fecha.
 */
const PALABRAS_DE_TIEMPO = new Set(
  [
    'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo', 'hoy', 'manana', 'pasado', 'tarde', 'noche', 'mediodia', 'semana', 'semanas', 'quincena', 'mes', 'meses', 'dia', 'dias', 'ano',
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'setiembre', 'octubre', 'noviembre', 'diciembre',
    'reyes', 'navidad', 'navidades', 'pascua', 'verano', 'vacaciones', 'fiestas', 'festivos', 'black', 'friday', 'cyber', 'prime', 'campana', 'principios', 'finales', 'final',
    'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'quince', 'veinte', 'horas', 'hora',
  ]
)

export function fraseDiceCuando(frase: string): boolean {
  return normalizar(frase)
    .split(' ')
    .some((palabra) => PALABRAS_DE_TIEMPO.has(palabra) || /^\d/.test(palabra))
}

/* ------------------------------------------------------------------ */
/* El día de la semana que se dijo                                     */
/* ------------------------------------------------------------------ */

const NOMBRES_DE_DIA: ReadonlyArray<readonly [string, number]> = [
  ['domingo', 0],
  ['lunes', 1],
  ['martes', 2],
  ['miercoles', 3],
  ['jueves', 4],
  ['viernes', 5],
  ['sabado', 6],
]

/** El día de la semana (0 = domingo … 6 = sábado) que nombra la frase, o null si no nombra ninguno o nombra varios (no se puede saber a cuál se refiere) */
export function diaDeLaSemanaDicho(frase: string): number | null {
  const palabras = new Set(normalizar(frase).split(' '))
  const dichos = NOMBRES_DE_DIA.filter(([nombre]) => palabras.has(nombre) || palabras.has(`${nombre}s`))
  return dichos.length === 1 ? dichos[0][1] : null
}

/** Si el cliente nombró un día de la semana, ¿cae `fecha` en ese día? Sin día nombrado (o con varios) no hay nada que comprobar y vale */
export function fechaCuadraConLaFrase(fecha: string, frase: string): boolean {
  const dicho = diaDeLaSemanaDicho(frase)
  return dicho === null || diaDeLaSemana(fecha) === dicho
}

/* ------------------------------------------------------------------ */
/* Enseñar un día                                                      */
/* ------------------------------------------------------------------ */

/** «lun 11 ene» y, si no es de este año, «lun 11 ene 2027» */
export function diaConAnio(dia: string, hoy: string): string {
  return dia.slice(0, 4) === hoy.slice(0, 4) ? diaCorto(dia) : `${diaCorto(dia)} ${dia.slice(0, 4)}`
}
