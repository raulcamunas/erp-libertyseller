import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'
import { cn } from '@/lib/utils'
import { mezcla } from './utilidades'

/**
 * INSIGNIA / CHIP DE ESTADO. Glifo (punto o icono) + palabra + color: el estado se entiende aunque no se distinga el color. Los tonos salen de COLOR_ESTADO (lib/estilo/denso),
 * con contraste medido en los dos temas.
 *
 *   <Insignia tono="verde">Activa</Insignia>
 *   <Insignia tono="ambar" icono={Clock} variante="solida">Pendiente</Insignia>
 *   <InsigniaDeEstado estado="en_curso" />          ← usa TONO_DE_ESTADO
 */
export interface InsigniaProps {
  tono?: TonoEstado
  children: ReactNode
  icono?: LucideIcon
  /** Punto de color delante (por defecto, si no hay icono) */
  punto?: boolean
  /** Punto que late: para lo que está pasando ahora */
  vivo?: boolean
  variante?: 'suave' | 'solida' | 'contorno'
  tamano?: 'sm' | 'md'
  className?: string
  title?: string
}

export function Insignia({ tono = 'gris', children, icono: Icono, punto = !Icono, vivo, variante = 'suave', tamano = 'md', className, title }: InsigniaProps) {
  const color = COLOR_ESTADO[tono]
  const estilo =
    variante === 'solida'
      ? { background: mezcla(color, 22), color, borderColor: mezcla(color, 40) }
      : variante === 'contorno'
        ? { background: 'transparent', color, borderColor: mezcla(color, 45) }
        : { background: mezcla(color, 12), color, borderColor: mezcla(color, 22) }
  return (
    <span
      title={title}
      className={cn(
        'inline-flex max-w-full shrink-0 items-center gap-[6px] whitespace-nowrap rounded-full border font-medium leading-none',
        tamano === 'sm' ? 'h-[20px] px-[7px] text-[11px]' : 'h-[24px] px-[9px] text-[12px]',
        className,
      )}
      style={estilo}
    >
      {Icono ? (
        <Icono className={tamano === 'sm' ? 'h-3 w-3' : 'h-[13px] w-[13px]'} aria-hidden />
      ) : punto ? (
        <span className="relative inline-flex h-[6px] w-[6px]" aria-hidden>
          {vivo && <span className="absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping" style={{ background: color }} />}
          <span className="relative inline-flex h-[6px] w-[6px] rounded-full" style={{ background: color }} />
        </span>
      ) : null}
      <span className="truncate">{children}</span>
    </span>
  )
}

/**
 * LA PALETA POR ESTADO, para que el mismo estado se pinte igual en todos los módulos. Claves en minúscula y sin tildes; si un módulo tiene un estado propio, pásale `tono`
 * directamente a <Insignia>.
 */
export const TONO_DE_ESTADO: Record<string, { tono: TonoEstado; texto: string }> = {
  borrador: { tono: 'gris', texto: 'Borrador' },
  pendiente: { tono: 'ambar', texto: 'Pendiente' },
  en_revision: { tono: 'violeta', texto: 'En revisión' },
  en_curso: { tono: 'azul', texto: 'En curso' },
  programado: { tono: 'cian', texto: 'Programado' },
  hecho: { tono: 'verde', texto: 'Hecho' },
  activo: { tono: 'verde', texto: 'Activo' },
  pausado: { tono: 'ambar', texto: 'Pausado' },
  bloqueado: { tono: 'rojo', texto: 'Bloqueado' },
  error: { tono: 'rojo', texto: 'Error' },
  vencido: { tono: 'rojo', texto: 'Vencido' },
  cancelado: { tono: 'gris', texto: 'Cancelado' },
  archivado: { tono: 'gris', texto: 'Archivado' },
}

export function InsigniaDeEstado({ estado, texto, tamano, className }: { estado: string; texto?: string; tamano?: 'sm' | 'md'; className?: string }) {
  const e = TONO_DE_ESTADO[estado] ?? { tono: 'gris' as TonoEstado, texto: estado }
  return (
    <Insignia tono={e.tono} tamano={tamano} vivo={estado === 'en_curso'} className={className}>
      {texto ?? e.texto}
    </Insignia>
  )
}
