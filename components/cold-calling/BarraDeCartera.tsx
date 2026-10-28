'use client'

import { CalendarClock, Link2, ListChecks, Loader2, PanelRight, Table2, type LucideIcon } from 'lucide-react'
import type { ResumenDeCartera } from '@/lib/cold-calling/cartera'
import { BOTON, CIFRAS, INSIGNIA, TITULO } from '@/lib/estilo/denso'
import type { CalendarPerson } from '@/lib/types/appointments'
import { Numero } from '@/components/rendimiento/ui'

/**
 * LA CABECERA DE COLD CALLING: el título, las cuatro cifras de la cartera y lo que se puede cambiar de ver.
 *
 * Todo en UNA fila. Antes eran un título con un párrafo de dos líneas, cuatro tarjetas de 58 px y, debajo, la barra de vistas: el
 * comercial abría la pantalla y tenía que bajar la vista para ver el primer lead. Ahora las cifras son una tira de 28 px.
 *
 * LA CIFRA NARANJA, «PARA LLAMAR», ES LA QUE HAY QUE ATENDER HOY Y ES UN BOTÓN: lleva a la agenda de rellamadas. Cuenta las de hoy y las
 * que se pasaron de fecha, y es la MISMA cifra que el aviso de la pestaña «Rellamadas»; antes una decía 28 y la otra 0, porque una
 * contaba las atrasadas y la otra no, y parecía que la pantalla estaba rota.
 */

export type VistaDeCartera = 'ficha' | 'tabla' | 'rellamadas' | 'listas'

const VISTAS: ReadonlyArray<{ id: VistaDeCartera; icono: LucideIcon; etiqueta: string; ayuda: string }> = [
  { id: 'ficha', icono: PanelRight, etiqueta: 'Ficha', ayuda: 'La lista a la izquierda y la ficha del lead a la derecha: para trabajar un lead a fondo' },
  { id: 'tabla', icono: Table2, etiqueta: 'Tabla', ayuda: 'Como el Excel: muchos leads a la vez, con el estado y la rellamada editables en la fila' },
  { id: 'rellamadas', icono: CalendarClock, etiqueta: 'Rellamadas', ayuda: 'La agenda del día: a quién se prometió volver a llamar' },
  { id: 'listas', icono: ListChecks, etiqueta: 'Listas', ayuda: 'Las listas de leads: lo usadas que están, mover leads entre ellas, asignarlas al equipo y añadir tiendas nuevas' },
]

interface Props {
  resumen: ResumenDeCartera
  vista: VistaDeCartera
  onVista: (v: VistaDeCartera) => void
  puedeVerTodos: boolean
  team: readonly CalendarPerson[]
  propietario: string
  onPropietario: (id: string) => void
  /** Se están trayendo leads de otro comercial */
  cargando: boolean
  onTelefonos: () => void
  /** ¿Puede gestionar las listas de leads? Solo entonces sale la vista «Listas» */
  puedeGestionarListas: boolean
}

const porcentaje = (p: number) => `${(p * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`

export function BarraDeCartera({ resumen, vista, onVista, puedeVerTodos, team, propietario, onPropietario, cargando, onTelefonos, puedeGestionarListas }: Props) {
  // En «Listas» la cabecera se queda en el título y las vistas: las cifras y el selector de cartera son de una cartera, y esa pantalla trae las suyas
  const enListas = vista === 'listas'
  const trabajadosPct = resumen.total > 0 ? resumen.trabajados / resumen.total : 0

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h1 className={TITULO.pantalla}>Cold Calling</h1>

      <div className={`${CIFRAS.tira} max-w-full overflow-x-auto ${enListas ? 'hidden' : ''}`} role="group" aria-label="Resumen de la cartera">
        <div className={CIFRAS.celda}>
          <span className={CIFRAS.valor}>
            <Numero valor={resumen.total} />
          </span>
          <span className={CIFRAS.rotulo}>en cartera</span>
        </div>
        <div className={CIFRAS.celda} title="Leads que ya se han tocado: cualquier estado menos «Sin contactar»">
          <span className={CIFRAS.valor}>
            <Numero valor={resumen.trabajados} />
          </span>
          <span className={CIFRAS.rotulo}>trabajados · {porcentaje(trabajadosPct)}</span>
        </div>
        <div className={CIFRAS.celda} title="Citas agendadas, y qué parte de los trabajados son">
          <span className={CIFRAS.valor}>
            <Numero valor={resumen.cualificados} />
          </span>
          <span className={CIFRAS.rotulo}>citas · {porcentaje(resumen.conversion)}</span>
        </div>
        <button
          type="button"
          onClick={() => onVista('rellamadas')}
          title={resumen.paraLlamar === 0 ? 'No hay ninguna rellamada pendiente' : `Rellamadas de hoy y atrasadas${resumen.atrasadas > 0 ? ` (${resumen.atrasadas} se pasaron de fecha)` : ''}: abrir la agenda`}
          className={`${CIFRAS.celda} transition-colors hover:bg-[var(--ls-sup3)]`}
        >
          <span className={`${CIFRAS.valor} ${resumen.paraLlamar > 0 ? CIFRAS.urgente : ''}`}>
            <Numero valor={resumen.paraLlamar} />
          </span>
          <span className={CIFRAS.rotulo}>para llamar</span>
        </button>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {cargando && !enListas && (
          <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--ls-t4)]" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Cargando leads…
          </span>
        )}

        {puedeVerTodos && team.length > 0 && !enListas && (
          <select value={propietario} onChange={(e) => onPropietario(e.target.value)} aria-label="Cartera de" className={`${BOTON.chip} !h-7 cursor-pointer !pr-1.5 outline-none`}>
            <option value="all" className="bg-[var(--ls-sup)]">
              Todos los comerciales
            </option>
            {team.map((p) => (
              <option key={p.id} value={p.id} className="bg-[var(--ls-sup)]">
                {p.full_name || p.email}
              </option>
            ))}
          </select>
        )}

        {puedeVerTodos && (
          <button type="button" onClick={onTelefonos} className={`${BOTON.chip} !h-7`} title="Comprobar que las llamadas de Rinkel se enlazan con los teléfonos de los leads">
            <Link2 className="h-3.5 w-3.5" aria-hidden /> Teléfonos
          </button>
        )}

        <div role="group" aria-label="Vista" className="flex items-center gap-0.5 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-0.5">
          {VISTAS.filter((v) => v.id !== 'listas' || puedeGestionarListas).map((v) => {
            const activa = vista === v.id
            const Icono = v.icono
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => onVista(v.id)}
                aria-pressed={activa}
                title={v.ayuda}
                className={`inline-flex h-6 items-center gap-1.5 rounded-[4px] px-2.5 text-[11.5px] font-medium transition-colors ${
                  activa ? 'bg-[var(--ls-sup3)] text-[var(--ls-t1)] shadow-[inset_0_0_0_1px_var(--ls-acc-graf)]' : 'text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]'
                }`}
              >
                <Icono className="h-3.5 w-3.5" aria-hidden />
                {v.etiqueta}
                {v.id === 'rellamadas' && resumen.paraLlamar > 0 && <span className={INSIGNIA.contador}>{resumen.paraLlamar.toLocaleString('es-ES')}</span>}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
