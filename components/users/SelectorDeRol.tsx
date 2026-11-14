'use client'

import { Briefcase, Building2, Crown, Handshake, Headset, PhoneCall, ShieldCheck, Store, UserRound, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FOCO } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { CASILLA_POR_ID, casillasDelPuesto } from '@/lib/usuarios/casillas'
import { OPCIONES_DE_ROL, llevaListaPropia, rolYPuestoDe, type OpcionDeRol } from '@/lib/usuarios/puestos'
import { Interruptor, TONO_DE_OPCION } from './piezas'

/**
 * EL ROL DE UNA PERSONA, EN TARJETAS (antes un <select> nativo).
 *
 * Ofrece los roles de siempre (Empleado, Admin, Partner, Cliente), los puestos del equipo (Comercial, Manager Comercial, Comercial Autónomo, Gestión Administrativa) y el CEO.
 * Los puestos NO son roles nuevos: al guardar se convierten en rol «empleado» + puesto, y el CEO en «admin» + puesto 'ceo' (lib/usuarios/puestos.ts). Al elegir uno, la ficha
 * pre-marca sus casillas. Debajo se dice qué significa lo elegido y qué accesos marca, para que no haya sorpresas.
 *
 * Al crear se ofrece, además, crear la lista de leads de quien llama.
 */

const ICONO_DE_OPCION: Record<OpcionDeRol, LucideIcon> = {
  employee: UserRound,
  comercial: PhoneCall,
  manager_comercial: Users,
  comercial_autonomo: Briefcase,
  gestion_administrativa: Building2,
  admin: ShieldCheck,
  ceo: Crown,
  partner: Handshake,
  cliente: Store,
}

const GRUPOS: ReadonlyArray<{ id: 'empleado' | 'puesto' | 'direccion' | 'externo'; nombre: string }> = [
  { id: 'puesto', nombre: 'Puestos del equipo' },
  { id: 'empleado', nombre: 'Sin puesto' },
  { id: 'direccion', nombre: 'Dirección' },
  { id: 'externo', nombre: 'Fuera de la agencia' },
]

interface Props {
  opcion: OpcionDeRol
  onCambiar: (opcion: OpcionDeRol) => void
  /** Si la persona llama (sale en el equipo de Cold Calling y en la Agenda). Solo se pregunta a un Manager Comercial */
  llama: boolean
  onLlama: (llama: boolean) => void
  /** Solo al crear: si se le crea su lista de leads. undefined = no se ofrece (al editar) */
  crearLista?: boolean
  onCrearLista?: (crear: boolean) => void
  /** Si no se puede cambiar (uno mismo, el dueño): el porqué */
  bloqueado?: string
}

export function SelectorDeRol({ opcion, onCambiar, llama, onLlama, crearLista, onCrearLista, bloqueado }: Props) {
  const actual = OPCIONES_DE_ROL.find((o) => o.valor === opcion) ?? OPCIONES_DE_ROL[0]
  const { puesto } = rolYPuestoDe(opcion)
  const marca = Array.from(casillasDelPuesto(puesto)).map((id) => CASILLA_POR_ID.get(id)?.nombre ?? id)
  const ofreceLista = crearLista !== undefined && onCrearLista !== undefined && llevaListaPropia(puesto, puesto === 'comercial' ? true : llama)

  return (
    <div className="flex flex-col gap-5">
      {bloqueado && <p className="rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 py-2 text-[12.5px] text-[var(--ls-e-ambar)]">{bloqueado}</p>}

      {GRUPOS.map((g) => {
        const opciones = OPCIONES_DE_ROL.filter((o) => o.grupo === g.id)
        return (
          <fieldset key={g.id} disabled={!!bloqueado} className="min-w-0">
            <legend className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[var(--ls-t4)]">{g.nombre}</legend>
            <div role="radiogroup" aria-label={g.nombre} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {opciones.map((o) => {
                const activa = o.valor === opcion
                const Icono = ICONO_DE_OPCION[o.valor]
                const color = COLOR_ESTADO[TONO_DE_OPCION[o.valor]]
                return (
                  <button
                    key={o.valor}
                    type="button"
                    role="radio"
                    aria-checked={activa}
                    onClick={() => onCambiar(o.valor)}
                    className={cn(
                      'relative flex min-h-[52px] items-center gap-3 rounded-[12px] border px-3 py-2 text-left transition-[border-color,background-color,transform] duration-150 disabled:cursor-not-allowed disabled:opacity-50 motion-safe:hover:-translate-y-px',
                      FOCO,
                      activa ? 'border-transparent' : 'border-[var(--ls-linea)] bg-[var(--ls-sup2)] hover:border-[var(--ls-linea2)]',
                    )}
                    style={activa ? { background: `color-mix(in srgb, ${color} 13%, var(--ls-sup))`, boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${color} 70%, transparent)` } : undefined}
                  >
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]"
                      style={{ background: `color-mix(in srgb, ${color} ${activa ? 24 : 12}%, transparent)`, color }}
                      aria-hidden
                    >
                      <Icono className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 text-[13.5px] font-medium text-[var(--ls-t1)]">{o.etiqueta}</span>
                  </button>
                )
              })}
            </div>
          </fieldset>
        )
      })}

      <div className="rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-3">
        <p className="flex items-start gap-2 text-[12.5px] leading-snug text-[var(--ls-t2)]">
          <Headset className="mt-[2px] h-[14px] w-[14px] shrink-0 text-[var(--ls-mod-personas)]" aria-hidden />
          {actual.ayuda}
        </p>
        {marca.length > 0 && (
          <p className="mt-2 text-[12px] leading-snug text-[var(--ls-t4)]">
            Marca de partida: {marca.slice(0, 8).join(', ')}
            {marca.length > 8 ? ` y ${marca.length - 8} más` : ''}. Se pueden cambiar en «Accesos» antes de guardar.
          </p>
        )}
      </div>

      {opcion === 'manager_comercial' && (
        <div className="flex items-center gap-3 rounded-[12px] border border-[var(--ls-linea)] px-3 py-1">
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-medium text-[var(--ls-t1)]">También llama y atiende citas</span>
            <span className="block text-[12px] text-[var(--ls-t4)]">Sale en el equipo de Cold Calling y en la Agenda, y se le pueden asignar leads.</span>
          </span>
          <Interruptor etiqueta="También llama y atiende citas" activo={llama} onCambio={onLlama} deshabilitado={!!bloqueado} />
        </div>
      )}

      {ofreceLista && (
        <div className="flex items-center gap-3 rounded-[12px] border border-[var(--ls-linea)] px-3 py-1">
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-medium text-[var(--ls-t1)]">Crearle su lista de leads</span>
            <span className="block text-[12px] text-[var(--ls-t4)]">Una lista con su nombre, asignada a esta persona, para repartirle leads desde Cold Calling → Listas.</span>
          </span>
          <Interruptor etiqueta="Crearle su lista de leads" activo={crearLista === true} onCambio={(v) => onCrearLista?.(v)} />
        </div>
      )}
    </div>
  )
}
