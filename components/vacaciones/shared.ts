import {
  VACATION_STATUS_COLORS,
  VACATION_STATUS_LABELS,
  type VacationRequest,
  type VacationStatus,
} from '@/lib/types/vacations'

/**
 * Piezas de interfaz compartidas del módulo de vacaciones.
 *
 * SIN 'use client' A PROPÓSITO, igual que components/empleados/shared.ts y
 * components/marketing/shared.ts: los Server Components de las dos pantallas
 * importan de aquí las clases de la cabecera, y bastaría con ponerle la
 * directiva a este fichero para romper esa importación.
 *
 * POR QUÉ SE REPITEN LAS CLASES EN VEZ DE IMPORTARLAS DEL MÓDULO DE AL LADO
 * ------------------------------------------------------------------------
 * Son los mismos tokens que usa Control empleados, y aun así se vuelven a
 * escribir aquí: la pantalla del empleado (/dashboard/vacaciones) no debe
 * depender de un fichero del módulo de SUELDOS ni para una cadena de CSS. Es
 * la misma razón por la que marketing tiene su copia. Lo que sí está
 * prohibido duplicar es el CÁLCULO: eso vive entero en lib/types/vacations.ts
 * y de ahí no se copia ni una línea.
 *
 * Solo se usan opacidades que la capa de traducción de globals.css sabe
 * reinterpretar en tema claro (white/10, white/[0.02], white/45…). Una
 * opacidad inventada se quedaría blanca sobre fondo blanco.
 */

/** Campo de formulario visible siempre */
export const fieldInput =
  'w-full bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-1.5 text-[12px] text-white outline-none focus:border-[#FF6600] transition-colors placeholder:text-white/25'

/** Sin [color-scheme:dark] el selector nativo de fecha sale blanco sobre oscuro */
export const dateInput = `${fieldInput} [color-scheme:dark]`

export const primaryButton =
  'h-8 px-3.5 rounded-full bg-gradient-to-b from-[#FF7A1F] to-[#FF6600] text-white text-[12px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40 transition-opacity'

export const ghostButton =
  'h-8 px-3.5 rounded-full border border-white/10 bg-white/[0.03] text-white/75 text-[12px] font-medium flex items-center justify-center gap-1.5 hover:bg-white/[0.06] hover:border-white/20 transition-colors disabled:opacity-50'

/** Rechazar y anular: rojo, porque deshacen algo */
export const dangerButton =
  'h-8 px-3.5 rounded-full border border-red-500/30 bg-red-500/[0.08] text-red-300 text-[12px] font-medium flex items-center justify-center gap-1.5 hover:bg-red-500/[0.14] hover:border-red-500/50 transition-colors disabled:opacity-50'

export const cardShell = 'rounded-xl border border-white/10 bg-white/[0.02]'

/** Aviso ámbar: el código de «ojo con esto» de todo el ERP */
export const warnBox =
  'rounded-lg border border-yellow-500/25 bg-yellow-400/[0.06] px-2.5 py-2 text-[11px] text-yellow-300 leading-relaxed'

/** Error rojo: esto no se puede guardar */
export const errorBox =
  'rounded-lg border border-red-500/30 bg-red-500/[0.08] px-2.5 py-2 text-[11px] text-red-300 leading-relaxed'

/** La insignia de estado, con las clases completas del dominio */
export function statusPill(status: VacationStatus): string {
  return `inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${VACATION_STATUS_COLORS[status]}`
}

export function statusLabel(status: VacationStatus): string {
  return VACATION_STATUS_LABELS[status]
}

/**
 * Quién tecleó la petición, cuando NO fue la propia persona.
 *
 * Importa que se vea: media plantilla no tiene cuenta en el ERP y sus
 * vacaciones las registra un admin. Sin esta línea, dentro de seis meses nadie
 * sabría si Yasury pidió esos días o si alguien se los apuntó por ella.
 */
export function registeredBy(
  request: VacationRequest,
  people: Record<string, string>,
  employeeUserId: string | null
): string | null {
  if (!request.created_by) return null
  if (employeeUserId && request.created_by === employeeUserId) return null
  return people[request.created_by] ?? 'otra persona'
}

function firma(
  who: string | null | undefined,
  when: string | null,
  people: Record<string, string>
): string | null {
  const quien = who ? people[who] ?? 'alguien que ya no está en el ERP' : null
  const cuando = when
    ? new Date(when).toLocaleDateString('es-ES', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null
  if (quien && cuando) return `${quien} · ${cuando}`
  return quien ?? cuando
}

/** Quién la aprobó o la rechazó, y cuándo */
export function resolvedBy(
  request: VacationRequest,
  people: Record<string, string>
): string | null {
  return firma(request.resolved_by, request.resolved_at, people)
}

/**
 * Quién la RETIRÓ, y cuándo.
 *
 * Aparte de `resolvedBy` porque son dos firmas distintas que pueden convivir en
 * la misma fila: unas vacaciones aprobadas por Mario y anuladas después por
 * Raúl tienen que enseñar las dos cosas. Cuando esto escribía encima de
 * resolved_by, la de Mario desaparecía.
 */
export function cancelledBy(
  request: VacationRequest,
  people: Record<string, string>
): string | null {
  return firma(request.cancelled_by, request.cancelled_at, people)
}

/**
 * El color de un saldo. El cero NO se pinta como un número normal: «0 días
 * disponibles» y «no genera vacaciones» se leen igual en pantalla y no son lo
 * mismo, así que el cero va apagado y el negativo en rojo.
 */
export function balanceTone(n: number): string {
  if (n < 0) return 'text-red-400'
  if (n === 0) return 'text-white/40'
  return 'text-white'
}
