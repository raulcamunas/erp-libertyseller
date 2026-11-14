import Link from 'next/link'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Boton } from './Boton'
import { colorDeAcento, mezcla, type Modulo } from './utilidades'

/**
 * ESTADO VACÍO. Siempre dice QUÉ pasa y QUÉ hacer: icono dentro de una «ilustración» de anillos con el acento del módulo, título, una frase y (casi siempre) una acción.
 *
 *   <EstadoVacio icono={Package} titulo="Aún no hay envíos" descripcion="Crea el primero para…" accion={{ texto: 'Nuevo envío', onClick }} acento="remesas" />
 *   <EstadoVacio compacto titulo="Sin resultados" descripcion="Prueba con otro filtro" />    ← dentro de una tabla o tarjeta
 */
export interface AccionDeVacio {
  texto: string
  onClick?: () => void
  href?: string
  icono?: LucideIcon
}

export interface EstadoVacioProps {
  icono?: LucideIcon
  titulo: string
  descripcion?: ReactNode
  accion?: AccionDeVacio
  accionSecundaria?: AccionDeVacio
  acento?: Modulo | string
  compacto?: boolean
  className?: string
}

function BotonDeAccion({ a, primaria }: { a: AccionDeVacio; primaria: boolean }) {
  const variante = primaria ? 'primario' : 'secundario'
  if (a.href) {
    return (
      <Boton asChild variante={variante} icono={a.icono}>
        <Link href={a.href}>{a.texto}</Link>
      </Boton>
    )
  }
  return (
    <Boton variante={variante} icono={a.icono} onClick={a.onClick}>
      {a.texto}
    </Boton>
  )
}

export function EstadoVacio({ icono: Icono = Inbox, titulo, descripcion, accion, accionSecundaria, acento, compacto, className }: EstadoVacioProps) {
  const color = colorDeAcento(acento)
  const lado = compacto ? 64 : 96
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compacto ? 'px-4 py-8' : 'px-6 py-14', className)} style={{ ['--ls-acento' as string]: color }}>
      <div className="relative" style={{ width: lado, height: lado }} aria-hidden>
        {/* Anillos: la «ilustración». Fondo radial del acento y dos círculos finos */}
        <div className="absolute inset-0 rounded-full" style={{ background: `radial-gradient(circle at 50% 40%, ${mezcla(color, 22)}, transparent 70%)` }} />
        <div className="absolute inset-0 rounded-full border" style={{ borderColor: mezcla(color, 18) }} />
        <div className="absolute rounded-full border border-dashed" style={{ inset: lado * 0.14, borderColor: mezcla(color, 28) }} />
        <div
          className="absolute flex items-center justify-center rounded-[14px] shadow-[var(--ls-sombra-1)]"
          style={{
            inset: lado * 0.3,
            background: `linear-gradient(145deg, ${mezcla(color, 30)}, ${mezcla(color, 12)})`,
            boxShadow: `inset 0 0 0 1px ${mezcla(color, 40)}, var(--ls-sombra-1)`,
            color,
          }}
        >
          <Icono className={compacto ? 'h-[14px] w-[14px]' : 'h-5 w-5'} strokeWidth={1.8} />
        </div>
      </div>
      <h3 className={cn('font-semibold tracking-[-0.01em] text-[var(--ls-t1)]', compacto ? 'mt-3 text-[13.5px]' : 'mt-5 text-[15.5px]')}>{titulo}</h3>
      {descripcion && <p className={cn('max-w-[42ch] text-[var(--ls-t3)]', compacto ? 'mt-1 text-[12.5px]' : 'mt-[6px] text-[13px] leading-[1.55]')}>{descripcion}</p>}
      {(accion || accionSecundaria) && (
        <div className={cn('flex flex-wrap items-center justify-center gap-2', compacto ? 'mt-4' : 'mt-6')}>
          {accion && <BotonDeAccion a={accion} primaria />}
          {accionSecundaria && <BotonDeAccion a={accionSecundaria} primaria={false} />}
        </div>
      )}
    </div>
  )
}
