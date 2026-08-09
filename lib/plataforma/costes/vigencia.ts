/**
 * ¿ESTE COSTE SIGUE VALIENDO? — DOMINIO PURO
 * ==========================================
 * Sin base de datos y sin reloj: la fecha entra por parámetro.
 *
 * LA VIGENCIA YA ESTÁ RESUELTA Y NO SE VUELVE A ESCRIBIR. costeVigente() y
 * costesVigentesPorSku() son de A1 (lib/plataforma/costes.ts), están probadas y
 * dicen lo que hay que decir: el coste de una fecha es el de la fila con el
 * `valido_desde` MÁS ALTO que no la supere. Aquí se importan y se re-exportan
 * para que quien trabaja en A5 no tenga que saber que viven en otro sitio, y se
 * les añade lo que A5 sí necesita y allí no existía: la ANTIGÜEDAD y la
 * CADUCIDAD.
 *
 *
 * ============ POR QUÉ LA CADUCIDAD ES TERNARIA ============
 *
 * Porque «cuántos días vale un coste» es una regla de negocio, y las reglas de
 * negocio las pone el usuario. Mientras nadie la haya puesto, el estado es
 * `sin_politica` y la pantalla enseña la antigüedad en días —que es un hecho— en
 * vez de pintar de rojo un coste que a lo mejor está perfectamente vigente.
 *
 * Colapsar `sin_politica` en `vigente` sería igual de mentiroso que colapsarlo
 * en `caducado`: en un caso se da por bueno lo que nadie ha mirado, en el otro
 * se alarma sobre lo que nadie ha decidido.
 */

import { costeVigente, costesVigentesPorSku, type TramoCoste } from '../costes'

export { costeVigente, costesVigentesPorSku }
export type { TramoCoste }

export type EstadoVigencia = 'sin_coste' | 'vigente' | 'caducado' | 'sin_politica'

export const ESTADO_VIGENCIA_LABELS: Record<EstadoVigencia, string> = {
  sin_coste: 'Sin coste',
  vigente: 'Vigente',
  caducado: 'Caducado',
  sin_politica: 'Sin política',
}

/**
 * Cuántos días lleva rigiendo un coste, contados desde su `valido_desde`.
 *
 * Las dos fechas son 'YYYY-MM-DD' y se comparan como fechas UTC a mediodía. Lo
 * de mediodía no es una manía: construir `new Date('2026-03-01')` da medianoche
 * UTC, y en cuanto el contenedor corre en otra zona horaria la resta se
 * desplaza un día. A mediodía sobra margen para cualquier huso y para el cambio
 * de hora.
 *
 * Devuelve un número negativo si el tramo todavía no ha entrado en vigor, que es
 * un dato legítimo: un coste que empieza a regir el mes que viene.
 */
export function antiguedadDias(validoDesde: string, hoy: string): number | null {
  const desde = fechaUtc(validoDesde)
  const hasta = fechaUtc(hoy)
  if (desde === null || hasta === null) return null
  return Math.round((hasta - desde) / 86_400_000)
}

/**
 * El estado de vigencia de un coste.
 *
 * `diasCaducidad` es null mientras el cliente no tenga política, y entonces el
 * estado es `sin_politica`: se sabe la antigüedad y no se sabe si eso es mucho.
 */
export function estadoVigencia(
  tramo: Pick<TramoCoste, 'valido_desde'> | null,
  hoy: string,
  diasCaducidad: number | null
): { estado: EstadoVigencia; dias: number | null } {
  if (tramo === null) return { estado: 'sin_coste', dias: null }

  const dias = antiguedadDias(tramo.valido_desde, hoy)
  if (dias === null) return { estado: 'sin_politica', dias: null }
  if (diasCaducidad === null || diasCaducidad <= 0) return { estado: 'sin_politica', dias }
  return { estado: dias > diasCaducidad ? 'caducado' : 'vigente', dias }
}

/**
 * La frase que explica un coste viejo.
 *
 * Igual que porQueSinMargen(): donde no hay número, hay explicación. Un hueco
 * explicado no es un hueco.
 */
export function porQueCaducado(
  estado: EstadoVigencia,
  dias: number | null,
  diasCaducidad: number | null
): string {
  switch (estado) {
    case 'sin_coste':
      return 'No hay ningún coste vigente para este SKU en esta fecha.'
    case 'caducado':
      return `El coste lleva ${dias} días sin actualizarse y la política de este cliente son ${diasCaducidad}. Pídele el fichero nuevo antes de fiarte del margen.`
    case 'sin_politica':
      return dias === null
        ? 'No se ha podido calcular la antigüedad de este coste.'
        : `El coste entró en vigor hace ${dias} días. Este cliente no tiene decidido a partir de cuántos días un coste deja de valer, así que no se puede decir si está caducado.`
    default:
      return ''
  }
}

/** 'YYYY-MM-DD' -> milisegundos del mediodía UTC de ese día. null si no es una fecha */
function fechaUtc(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
  return Number.isFinite(t) ? t : null
}

/** La fecha de hoy en 'YYYY-MM-DD', en hora local, que es la que ve quien mira la pantalla */
export function hoyIso(ahora: Date = new Date()): string {
  const y = ahora.getFullYear()
  const m = String(ahora.getMonth() + 1).padStart(2, '0')
  const d = String(ahora.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** ¿Es una fecha 'YYYY-MM-DD' de verdad? Se usa al validar lo que llega del navegador */
export function esFechaIso(valor: unknown): valor is string {
  return typeof valor === 'string' && fechaUtc(valor) !== null
}
