/**
 * EL PROGRAMADOR DE INFORMES DE MARKETING
 * =======================================
 * SOLO SERVIDOR.
 *
 * El calendario de Informes Marketing guarda una fila por día marcado, con su
 * cuenta de anunciante y su periodo. Esto es lo que las convierte en encargos
 * cuando llega su día.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { PLANTILLAS, PLANTILLAS_POR_ID } from './plantillas'
import { empujar, encargar } from './generador'

/** 7d = la semana anterior · 14d = las dos anteriores · 4s = las cuatro */
export type PeriodoInforme = '7d' | '14d' | '4s'

export const PERIODOS: { id: PeriodoInforme; etiqueta: string; ayuda: string }[] = [
  { id: '7d', etiqueta: '1 semana', ayuda: 'La semana anterior completa, de lunes a domingo' },
  { id: '14d', etiqueta: '2 semanas', ayuda: 'Las dos semanas anteriores completas' },
  { id: '4s', etiqueta: '4 semanas', ayuda: 'Las cuatro anteriores. Es el mensual de la agencia' },
]

const SEMANAS: Record<PeriodoInforme, number> = { '7d': 1, '14d': 2, '4s': 4 }

/* ------------------------------------------------------------------ */
/* La aritmética de las semanas                                        */
/* ------------------------------------------------------------------ */

/**
 * DE QUÉ FECHA A QUÉ FECHA, EN SEMANAS COMPLETAS.
 *
 * Esta función es el corazón del módulo, así que conviene que quede escrito qué
 * hace y por qué no hace lo obvio.
 *
 * Lo obvio sería «últimos 7 días»: del día anterior hacia atrás. Y estaría mal.
 * Un informe pedido el miércoles cortaría de miércoles a martes, y el de la
 * semana siguiente de miércoles a martes otra vez pero desplazado — dos informes
 * del mismo cliente que no se pueden poner uno al lado del otro, porque cada uno
 * corta la semana por un sitio distinto.
 *
 * Lo que hace es coger SEMANAS ENTERAS DE LUNES A DOMINGO, siempre anteriores al
 * día programado. Programado el miércoles 2 de septiembre:
 *
 *     1 semana  →  lunes 24 ago  ·  domingo 30 ago
 *     2 semanas →  lunes 17 ago  ·  domingo 30 ago
 *     4 semanas →  lunes  3 ago  ·  domingo 30 ago
 *
 * El domingo 30 es el último domingo COMPLETO antes de esa fecha, y de ahí se
 * cuenta hacia atrás. Da igual si el informe se genera el miércoles o el
 * viernes: los números de esa semana ya no cambian.
 *
 * TODO EN HORA DE ESPAÑA. Se opera sobre las tres cifras de la fecha —año, mes,
 * día— y nunca sobre un instante con huso, para que un informe programado el
 * lunes no se convierta en el domingo anterior por estar el servidor en UTC.
 */
export function rangoDe(fecha: string, periodo: PeriodoInforme): { desde: string; hasta: string } {
  const [a, m, d] = fecha.split('-').map(Number)
  // UTC a propósito: aquí no hay instante, hay un día de calendario. Con el
  // constructor local, un servidor en otro huso movería el día entero.
  const dia = new Date(Date.UTC(a, m - 1, d))

  // getUTCDay(): 0 es domingo. Se convierte a «cuántos días desde el lunes».
  const desdeElLunes = (dia.getUTCDay() + 6) % 7

  // El domingo anterior al lunes de esta semana: el último que está completo.
  const ultimoDomingo = new Date(dia)
  ultimoDomingo.setUTCDate(dia.getUTCDate() - desdeElLunes - 1)

  const primerLunes = new Date(ultimoDomingo)
  primerLunes.setUTCDate(ultimoDomingo.getUTCDate() - (SEMANAS[periodo] * 7 - 1))

  return { desde: iso(primerLunes), hasta: iso(ultimoDomingo) }
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** «24 ago → 30 ago», para enseñarlo al lado del periodo sin tener que calcularlo a ojo */
export function rangoLegible(fecha: string, periodo: PeriodoInforme): string {
  const { desde, hasta } = rangoDe(fecha, periodo)
  const corto = (s: string) => {
    const [, mm, dd] = s.split('-')
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
    return `${Number(dd)} ${meses[Number(mm) - 1]}`
  }
  return `${corto(desde)} → ${corto(hasta)}`
}

/* ------------------------------------------------------------------ */
/* Lanzar lo que toque                                                 */
/* ------------------------------------------------------------------ */

export interface ResultadoProgramador {
  lanzados: number
  fallidos: number
  detalle: string[]
}

/**
 * CONVIERTE EN ENCARGOS LAS PROGRAMACIONES QUE YA TOCAN.
 *
 * Lo llama el cron una vez al día. Coge las pendientes cuya fecha ya ha llegado
 * —incluidas las de días pasados, que es lo que hay que querer: si el servidor
 * estuvo caído el martes, el miércoles se lanza igual en vez de perderse— y por
 * cada una crea el encargo con el rango de semanas completas que le toca.
 *
 * Una que falla NO se lleva por delante a las demás: se marca con su error y se
 * sigue. Son clientes distintos y el fallo de uno no dice nada del otro.
 */
export async function lanzarProgramadas(hoy: string): Promise<ResultadoProgramador> {
  const service = createServiceClient()

  const { data, error } = await service
    .from('marketing_programaciones')
    .select('id, perfil_id, fecha, periodo, plantillas')
    .eq('estado', 'pendiente')
    .lte('fecha', hoy)
    .order('fecha', { ascending: true })
    .limit(50)

  if (error) throw error
  const pendientes = (data ?? []) as unknown as {
    id: string
    perfil_id: string
    fecha: string
    periodo: PeriodoInforme
    plantillas: string[]
  }[]

  const salida: ResultadoProgramador = { lanzados: 0, fallidos: 0, detalle: [] }

  for (const p of pendientes) {
    try {
      const { desde, hasta } = rangoDe(p.fecha, p.periodo)

      /**
       * Sin plantillas elegidas van TODAS las que se pueden pedir.
       *
       * Es lo que se quiere de un informe programado: al montarlo en el
       * calendario no se está pensando en qué pestañas hacen falta dentro de
       * tres semanas, y una que sobra no molesta mientras que una que falta
       * obliga a repetir el encargo entero.
       */
      const plantillas =
        p.plantillas.length > 0
          ? p.plantillas.filter((id) => {
              const t = PLANTILLAS_POR_ID.get(id)
              return t !== undefined && !t.imposible
            })
          : PLANTILLAS.filter((t) => !t.imposible).map((t) => t.id)

      const informeId = await encargar({
        perfilId: p.perfil_id,
        desde,
        hasta,
        plantillas,
        // null: no lo ha pedido nadie, lo ha pedido el calendario. Es lo que
        // distingue en la lista un informe programado de uno pedido a mano.
        usuario: null,
      })

      await service
        .from('marketing_programaciones')
        .update({
          estado: 'lanzado',
          informe_id: informeId,
          lanzado_at: new Date().toISOString(),
          error: null,
        })
        .eq('id', p.id)

      salida.lanzados += 1
      salida.detalle.push(`${p.fecha} · ${p.periodo} · ${desde} a ${hasta}`)
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : 'Error desconocido'
      await service
        .from('marketing_programaciones')
        .update({ estado: 'error', error: mensaje.slice(0, 500) })
        .eq('id', p.id)
      salida.fallidos += 1
      salida.detalle.push(`${p.fecha} · ${p.periodo} · FALLÓ: ${mensaje.slice(0, 120)}`)
    }
  }

  /**
   * Y UN EMPUJÓN A LOS QUE ESTÉN A MEDIAS.
   *
   * Pedir un informe a Amazon no lo trae: lo encarga. Sin esto, lo programado se
   * quedaría esperando al siguiente empujón de otro sitio, y el primer día de
   * uso eso se lee como «lo programé y no ha hecho nada».
   */
  if (salida.lanzados > 0) await empujar(6)

  return salida
}
