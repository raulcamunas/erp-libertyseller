/**
 * CUENTAS DE CLIENTES · EL AVISO AL RESPONSABLE DE CADA CUENTA, EN LA CAMPANA. SOLO SERVIDOR.
 *
 *   · LUNES   qué toca esa semana en cada cuenta suya (la semana del ciclo y sus pasos) y lo que ya está esperando: propuestas del motor de PPC,
 *             dinero gastado sin vender en lo que se propone cortar, fichas con stock que Amazon tiene con problemas.
 *   · JUEVES  solo si queda algo de la semana sin marcar como hecho: lo que falta, para que el informe no se quede sin mandar.
 *
 * Un aviso por cuenta y día (la clave `cuenta:<slug>:<día>` es única por persona: si el proceso pasa dos veces, el segundo choca y no repite).
 * Una cuenta sin responsable no avisa a nadie; una sin ciclo avisa el lunes de que hay que elegirlo. Solo escribe en `notifications`.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { clientesGrowth } from '@/lib/growth/clientes'
import { leerGestion, leerHechos } from './datos'
import { NOMBRE_SEMANA, pasosDeSemana, semanaDelCiclo } from './ciclo'
import { cifrasDeCumplimiento, ppcDeCliente } from './resumen'

export const TIPO_AVISO_CUENTA = 'cuenta_aviso'

export interface AvisoDeCuenta {
  userId: string
  slug: string
  titulo: string
  mensaje: string
}

const lista = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}`)
const euros = (n: number, moneda: string | null) => n.toLocaleString('es-ES', { style: 'currency', currency: moneda || 'EUR', maximumFractionDigits: 0 })

/** PURO. El texto del aviso de una cuenta, o null si no hay nada que decir */
export function textoDelAviso(e: {
  nombre: string
  dia: 'lunes' | 'jueves'
  semana: 1 | 2 | 3 | 4 | null
  pendientes: string[]
  propuestas: number
  recuperable: number
  moneda: string | null
  fichasConStock: number
}): { titulo: string; mensaje: string } | null {
  const extras: string[] = []
  if (e.propuestas > 0) extras.push(`${e.propuestas} ${e.propuestas === 1 ? 'propuesta' : 'propuestas'} de PPC por revisar${e.recuperable >= 5 ? ` (${euros(e.recuperable, e.moneda)} gastados sin vender en lo que se propone cortar)` : ''}`)
  if (e.fichasConStock > 0) extras.push(`${e.fichasConStock} ${e.fichasConStock === 1 ? 'ficha' : 'fichas'} con stock que Amazon tiene con problemas`)

  if (e.semana === null) {
    if (e.dia !== 'lunes') return null
    return { titulo: `${e.nombre}: elige cuándo empieza su ciclo`, mensaje: `Sin ciclo no se sabe qué toca cada semana. Ábrela en Cuentas de clientes y pulsa «Empezar esta semana».${extras.length ? ` Mientras: ${lista(extras)}.` : ''}` }
  }
  const nombreSemana = NOMBRE_SEMANA[e.semana]
  if (e.dia === 'lunes') {
    return { titulo: `${e.nombre} · ${nombreSemana}`, mensaje: `Esta semana: ${lista(e.pendientes.map((p) => p.toLowerCase()))}.${extras.length ? ` Ya esperando: ${lista(extras)}.` : ''}` }
  }
  if (e.pendientes.length === 0) return null
  return { titulo: `${e.nombre}: te ${e.pendientes.length === 1 ? 'queda 1 paso' : `quedan ${e.pendientes.length} pasos`} de la ${nombreSemana.split(' ·')[0]}`, mensaje: `Falta: ${lista(e.pendientes.map((p) => p.toLowerCase()))}.${extras.length ? ` Y ${lista(extras)}.` : ''}` }
}

/** Calcula y guarda los avisos del día. `dia` = AAAA-MM-DD en España; `cual` = lunes o jueves */
export async function avisarResponsables(dia: string, cual: 'lunes' | 'jueves'): Promise<{ avisados: number; cuentas: number; falta307: boolean }> {
  const [{ porCliente, falta307 }, clientes] = await Promise.all([leerGestion(), clientesGrowth()])
  if (falta307) return { avisados: 0, cuentas: 0, falta307 }
  const conResponsable = clientes.filter((c) => c.amazonClientId && c.activo && porCliente.get(c.amazonClientId)?.responsableId)
  const semanas = new Map(conResponsable.map((c) => [c.amazonClientId as string, semanaDelCiclo(porCliente.get(c.amazonClientId as string)?.cicloInicio, dia)]))
  const hechos = await leerHechos(conResponsable.flatMap((c) => {
    const s = semanas.get(c.amazonClientId as string)
    return s ? [{ amazonClientId: c.amazonClientId as string, lunes: s.lunes }] : []
  }))

  const avisos: AvisoDeCuenta[] = []
  for (const c of conResponsable) {
    const id = c.amazonClientId as string
    const s = semanas.get(id) ?? null
    const [ppc, cumplimiento] = await Promise.all([ppcDeCliente(id), cifrasDeCumplimiento(id)])
    const hecho = hechos.get(id) ?? new Set<string>()
    const t = textoDelAviso({
      nombre: c.nombre,
      dia: cual,
      semana: s?.semana ?? null,
      pendientes: s ? pasosDeSemana(s.semana).filter((p) => !hecho.has(p.id)).map((p) => p.titulo) : [],
      propuestas: ppc.cuentas.reduce((a, x) => a + x.pendientes, 0),
      recuperable: ppc.cuentas.reduce((a, x) => a + x.recuperable, 0),
      moneda: ppc.cuentas[0]?.moneda ?? null,
      fichasConStock: cumplimiento?.atencionConStock ?? 0,
    })
    if (t) avisos.push({ userId: porCliente.get(id)?.responsableId as string, slug: c.slug, ...t })
  }

  let avisados = 0
  const service = createServiceClient()
  for (const a of avisos) {
    const { error } = await service.from('notifications').insert({
      user_id: a.userId,
      type: TIPO_AVISO_CUENTA,
      title: a.titulo,
      message: a.mensaje,
      clave: `cuenta:${a.slug}:${dia}`,
      datos: { app: 'cuentas', slug: a.slug },
    })
    if (!error) avisados++
    else if ((error as { code?: string }).code !== '23505') console.error('[cuentas] aviso:', error.message)
  }
  return { avisados, cuentas: conResponsable.length, falta307 }
}
