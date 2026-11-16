import type { CalidadDatos, Prioridad, ResumenPlan, SaludCliente, TonoSalud } from '@/lib/fba/plan-tipos'

/**
 * EL PUNTO DE SALUD DE UN CLIENTE (rojo, ámbar, verde o gris) Y SU FRASE.
 * =====================================================================
 * PURO. Se comprueba con salud.prueba.ts. Spec remesas-pro §6.2 y §11 D42. Lo enseñan la barra de
 * clientes, las tarjetas de Hoy y el tablero; se ordena con `compararSalud`.
 *
 *  gris  · sin datos: no se puede planificar. Va PRIMERO en la regla (si no hay ventas leídas, un «verde»
 *          sería mentira) pero DETRÁS de rojo y ámbar al ordenar (lo que arde va antes que lo que no se ve).
 *          - Cliente sin envíos enviados (p. ej. Solter): «Cliente nuevo: el primer envío no lo propone el planificador».
 *          - Planificador apagado para el cliente.
 *          - Libro `sin_leer` o 0 movimientos en 90 días: «No hay ventas leídas: no se puede planificar».
 *  rojo  · hay referencias que van tarde o urgentes, o agotadas con ventas.
 *  ámbar · algo sale esta semana, el libro va más de 3 días atrasado o los plazos son «de partida».
 *  verde · nada de lo anterior.
 *
 * `ResumenPlan` no trae el recuento por prioridad. Si quien llama lo tiene (las líneas de la pasada), lo
 * pasa en `opciones.prioridades` y la regla es la de §6.2 al pie de la letra. Si no, se aproxima con lo
 * que sí trae el resumen: roturas en 14 días = rojo (con plazos de 2-3 semanas ya no se evitan con un
 * envío nuevo) y roturas en 30 días = ámbar.
 */

export const ORDEN_SALUD: Record<TonoSalud, number> = { rojo: 0, ambar: 1, gris: 2, verde: 3 }

/** Para `Array.sort`: rojo, ámbar, gris y verde */
export function compararSalud(a: SaludCliente | null, b: SaludCliente | null): number {
  return (a ? ORDEN_SALUD[a.tono] : 4) - (b ? ORDEN_SALUD[b.tono] : 4)
}

/** Días de atraso del libro a partir de los que el punto se pone ámbar */
export const ATRASO_AMBAR_DIAS = 3

export const FRASE_SIN_DATOS = 'No hay ventas leídas: no se puede planificar'
export const FRASE_CLIENTE_NUEVO = 'Cliente nuevo: el primer envío no lo propone el planificador'
export const FRASE_INACTIVO = 'El planificador está apagado para este cliente'

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
function fechaCorta(f: string): string {
  const [, m, d] = f.slice(0, 10).split('-').map(Number)
  return `${d} ${MESES[(m || 1) - 1]}`
}
const refs = (n: number) => `${n} ${n === 1 ? 'referencia' : 'referencias'}`
const unir = (partes: string[]) => partes.filter(Boolean).join(' · ')

export interface OpcionesSalud {
  /** El planificador corre para este cliente (`AjustesReposicion.activo`) */
  activo: boolean
  /** Movimientos del libro en los últimos 90 días */
  movimientos90: number
  /** true = el cliente aún no ha hecho su primer envío (no tiene remesas enviadas) */
  primerEnvio: boolean
  /** Recuento de líneas con propuesta por prioridad, si se tiene (regla exacta de §6.2) */
  prioridades?: Partial<Record<Prioridad, number>>
}

export function saludCliente(resumen: ResumenPlan | null, calidad: CalidadDatos | null, opciones: OpcionesSalud): SaludCliente {
  // ---- gris: no se puede planificar ----
  if (opciones.primerEnvio) return { tono: 'gris', motivo: FRASE_CLIENTE_NUEVO }
  if (!opciones.activo) return { tono: 'gris', motivo: FRASE_INACTIVO }
  if (!resumen || !calidad || calidad.libro === 'sin_leer' || opciones.movimientos90 <= 0) return { tono: 'gris', motivo: FRASE_SIN_DATOS }

  const p = opciones.prioridades
  const primera = resumen.primeraRotura ? `la primera el ${fechaCorta(resumen.primeraRotura)}` : ''

  // ---- rojo ----
  const rojos: string[] = []
  if (resumen.agotadosConVentas > 0) rojos.push(`${refs(resumen.agotadosConVentas)} ${resumen.agotadosConVentas === 1 ? 'agotada' : 'agotadas'} que se venden`)
  if (p) {
    const tarde = p.tarde ?? 0
    const urgente = p.urgente ?? 0
    if (tarde > 0) rojos.push(`${refs(tarde)} ya ${tarde === 1 ? 'va' : 'van'} tarde`)
    if (urgente > 0) rojos.push(`${refs(urgente)} ${urgente === 1 ? 'tiene' : 'tienen'} que salir en 3 días`)
  } else if (resumen.roturas14 > 0) {
    rojos.push(unir([`${refs(resumen.roturas14)} sin stock en 14 días`, primera]))
  }
  if (rojos.length > 0) return { tono: 'rojo', motivo: unir(rojos) }

  // ---- ámbar ----
  const ambar: string[] = []
  if (p) {
    const semana = p.esta_semana ?? 0
    if (semana > 0) ambar.push(`${refs(semana)} ${semana === 1 ? 'tiene' : 'tienen'} que salir esta semana`)
  } else if (resumen.roturas30 > 0) {
    ambar.push(unir([`${refs(resumen.roturas30)} sin stock en 30 días`, primera]))
  }
  if (calidad.diasAtraso !== null && calidad.diasAtraso > ATRASO_AMBAR_DIAS) {
    ambar.push(calidad.leidoHasta
      ? `ventas leídas hasta el ${fechaCorta(calidad.leidoHasta)} (${calidad.diasAtraso} días de atraso)`
      : `el libro va ${calidad.diasAtraso} días atrasado`)
  }
  if (calidad.plazoDePartida) ambar.push('plazos «de partida» sin confirmar')
  if (ambar.length > 0) {
    const frase = unir(ambar)
    return { tono: 'ambar', motivo: frase.charAt(0).toUpperCase() + frase.slice(1) }
  }

  // ---- verde ----
  const verde = [
    resumen.coberturaMediana !== null ? `Cubierto: ${Math.round(resumen.coberturaMediana)} días de cobertura mediana` : 'Cubierto',
    resumen.primeraRotura ? `primera rotura el ${fechaCorta(resumen.primeraRotura)}` : 'sin roturas a la vista',
  ]
  return { tono: 'verde', motivo: unir(verde) }
}
