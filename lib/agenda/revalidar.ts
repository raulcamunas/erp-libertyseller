/**
 * RELEER LAS SEMANAS QUE SE MIRAN SIN PISAR LO QUE SE HAYA TOCADO MIENTRAS SE LEÍA — SIN REACT NI RED PROPIA.
 * ==========================================================================================================
 * Leer de la base tarda (~0,15 s) y mientras tanto la pantalla sigue viva: alguien arrastra una cita, se guarda una ficha, llega un aviso en tiempo real. Una lectura que EMPEZÓ
 * antes de ese cambio y TERMINA después trae la cita como estaba, y aplicarla la devolvería a su sitio viejo hasta la siguiente lectura: una cita que se movió y vuelve, una que se
 * borró y reaparece. Es la trampa de siempre de «revalidar» y por eso vive aquí, con su prueba, y no repartida por el componente.
 *
 * La defensa es una VERSIÓN de la memoria: un número que sube con cada cambio que no es esta lectura (guardar, borrar, mover, un aviso en tiempo real aplicado). Se anota al empezar
 * y se compara al terminar; si cambió, la lectura ya no vale y se descarta —quien llama la repite, ya con lo último—. Descartar sale gratis: si algo está cambiando es que el tiempo
 * real está funcionando, y lo que se perdía es justo lo que esta lectura venía a cubrir.
 *
 * Las semanas contiguas se piden juntas (una consulta por tramo): las tres que se miran son casi siempre un solo tramo.
 *
 * NUNCA DEVUELVE MEDIA LECTURA: si un tramo falla, no hay citas de ninguno (igual que lib/agenda/consulta.ts).
 */

import type { AppointmentWithPeople } from '@/lib/types/appointments'
import type { ResultadoDeCitas } from './consulta'
import type { Rango } from './memoria'
import { claveDeSemana, limitesDeSemanas, semanasAlrededor, tramosDeSemanas } from './semanas'

export type LeerRango = (desde: string, hasta: string) => Promise<ResultadoDeCitas>

export type Relectura =
  /** No había ninguna semana que releer */
  | { tipo: 'nada' }
  /** Lo leído, con los rangos que cubre y las claves de las semanas que contienen (para anotar que se han confirmado) */
  | { tipo: 'leido'; rangos: Rango[]; citas: AppointmentWithPeople[]; semanas: string[] }
  /** La memoria cambió mientras se leía: esta lectura ya no vale */
  | { tipo: 'cambio-en-medio' }
  | { tipo: 'error'; error: unknown }

interface Entrada {
  /** Los lunes de las semanas a releer */
  lunes: Date[]
  leer: LeerRango
  /** La versión de la memoria ahora mismo */
  version: () => number
}

export async function releerSemanas({ lunes, leer, version }: Entrada): Promise<Relectura> {
  const tramos = tramosDeSemanas(lunes)
  if (tramos.length === 0) return { tipo: 'nada' }

  // La versión se anota ANTES de pedir nada
  const alEmpezar = version()
  const rangos: Rango[] = tramos.map((t) => limitesDeSemanas(t.lunes, t.semanas))

  let lecturas: ResultadoDeCitas[]
  try {
    lecturas = await Promise.all(rangos.map((r) => leer(r.desde, r.hasta)))
  } catch (error) {
    return { tipo: 'error', error }
  }
  const fallida = lecturas.find((l) => l.error)
  if (fallida) return { tipo: 'error', error: fallida.error }

  if (version() !== alEmpezar) return { tipo: 'cambio-en-medio' }

  return {
    tipo: 'leido',
    rangos,
    citas: lecturas.flatMap((l) => l.citas),
    semanas: tramos.flatMap((t) => semanasAlrededor(t.lunes, 0, t.semanas - 1).map(claveDeSemana)),
  }
}
