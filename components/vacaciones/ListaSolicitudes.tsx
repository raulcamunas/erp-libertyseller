'use client'

import { useMemo, useState } from 'react'
import { CalendarX2, ListChecks, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Boton, Confirmacion, Insignia, Segmentado, TablaAdaptable, type Columna } from '@/components/ui-ls'
import type { VacationsServerData } from '@/lib/employees/vacations'
import { formatDayRange, formatDays, type VacationRequest, type VacationStatus } from '@/lib/types/vacations'
import { colorDePersona } from '@/lib/vacations/calendario'
import { postVacations } from '@/lib/vacations/client'
import { AvatarDePersona } from './AvatarDePersona'
import { cancelledBy, resolvedBy } from './shared'
import { TEXTO_DE_ESTADO_VAC, TONO_DE_ESTADO_VAC } from './modelo'

type Filtro = 'todas' | VacationStatus

/**
 * LAS SOLICITUDES. El empleado ve las suyas (y retira las pendientes); el admin ve las de todo el equipo, filtra por
 * persona y estado, y puede anular también las aprobadas. Retirar o anular pide el motivo, que ahora se guarda (308).
 * Tabla en el PC, tarjetas en el móvil, paginada (TablaAdaptable).
 */
export function ListaSolicitudes({
  datos,
  esAdmin,
  userId,
  onHecho,
  onPedir,
}: {
  datos: VacationsServerData
  esAdmin: boolean
  userId: string
  onHecho: () => void
  onPedir?: () => void
}) {
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [persona, setPersona] = useState('')
  const [anulando, setAnulando] = useState<VacationRequest | null>(null)
  const [motivo, setMotivo] = useState('')

  const empleados = useMemo(() => new Map(datos.employees.map((e) => [e.id, e])), [datos.employees])
  const base = useMemo(() => (persona ? datos.requests.filter((r) => r.employee_id === persona) : datos.requests), [datos.requests, persona])
  const filas = useMemo(
    () => (filtro === 'todas' ? base : base.filter((r) => r.status === filtro)).slice().sort((a, b) => b.start_date.localeCompare(a.start_date) || b.id.localeCompare(a.id)),
    [base, filtro]
  )
  const cuenta = (s: VacationStatus) => base.filter((r) => r.status === s).length

  const esMia = (r: VacationRequest) => empleados.get(r.employee_id)?.user_id === userId
  const puedeAnular = (r: VacationRequest) => (r.status === 'pendiente' && (esAdmin || esMia(r))) || (r.status === 'aprobada' && esAdmin)

  const columnas: Columna<VacationRequest>[] = [
    ...(esAdmin
      ? [
          {
            id: 'persona',
            cabecera: 'Persona',
            movil: 'titulo' as const,
            ordenar: (r: VacationRequest) => empleados.get(r.employee_id)?.name ?? '',
            celda: (r: VacationRequest) => {
              const nombre = empleados.get(r.employee_id)?.name ?? 'Ficha borrada'
              return (
                <span className="flex items-center gap-2">
                  <AvatarDePersona nombre={nombre} color={datos.fichas[r.employee_id]?.color ?? colorDePersona(r.employee_id)} tamano={26} />
                  <span className="truncate font-medium text-[var(--ls-t1)]">{nombre}</span>
                </span>
              )
            },
          },
        ]
      : []),
    {
      id: 'fechas',
      cabecera: 'Fechas',
      movil: esAdmin ? 'subtitulo' : 'titulo',
      ordenar: (r) => r.start_date,
      celda: (r) => <span className="text-[var(--ls-t1)]">{formatDayRange(r.start_date, r.end_date)}</span>,
    },
    {
      id: 'dias',
      cabecera: 'Días',
      alinear: 'derecha',
      ancho: '90px',
      ordenar: (r) => Number(r.working_days),
      celda: (r) => <span className="tabular-nums">{formatDays(Number(r.working_days))}</span>,
    },
    {
      id: 'estado',
      cabecera: 'Estado',
      movil: 'insignia',
      ancho: '150px',
      ordenar: (r) => r.status,
      celda: (r) => (
        <span className="inline-flex flex-wrap gap-1">
          <Insignia tono={TONO_DE_ESTADO_VAC[r.status]} tamano="sm" vivo={r.status === 'pendiente'}>{TEXTO_DE_ESTADO_VAC[r.status]}</Insignia>
          {r.solape_autorizado && <Insignia tono="violeta" tamano="sm">Excepción</Insignia>}
          {r.late_notice && r.status === 'pendiente' && <Insignia tono="ambar" tamano="sm" punto={false}>Fuera de plazo</Insignia>}
        </span>
      ),
    },
    {
      id: 'detalle',
      cabecera: 'Detalle',
      rotuloMovil: 'Detalle',
      celda: (r) => <Detalle r={r} datos={datos} esAdmin={esAdmin} />,
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmentado
          etiqueta="Estado"
          tamano="sm"
          valor={filtro}
          onCambio={setFiltro}
          opciones={[
            { id: 'todas', texto: 'Todas', cuenta: base.length },
            { id: 'pendiente', texto: 'Pendientes', cuenta: cuenta('pendiente') },
            { id: 'aprobada', texto: 'Aprobadas', cuenta: cuenta('aprobada') },
            { id: 'rechazada', texto: 'Denegadas', cuenta: cuenta('rechazada') },
            { id: 'cancelada', texto: 'Anuladas', cuenta: cuenta('cancelada') },
          ]}
        />
        {esAdmin && (
          <select
            aria-label="Filtrar por persona"
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            className="h-9 rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 text-[13px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc-graf)] [@media(pointer:coarse)]:min-h-[44px]"
          >
            <option value="">Todo el equipo</option>
            {datos.employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        )}
      </div>

      <TablaAdaptable
        etiqueta="Solicitudes de vacaciones"
        columnas={columnas}
        filas={filas}
        claveDe={(r) => r.id}
        porPagina={15}
        acciones={(r) =>
          puedeAnular(r) ? (
            <Boton variante="fantasma" tamano="sm" icono={Undo2} onClick={() => { setMotivo(''); setAnulando(r) }}>
              {r.status === 'aprobada' ? 'Anular' : esMia(r) ? 'Retirar' : 'Anular'}
            </Boton>
          ) : null
        }
        vacio={{
          icono: filtro === 'todas' ? ListChecks : CalendarX2,
          titulo: filtro === 'todas' ? (esAdmin ? 'Aún no hay solicitudes' : 'Todavía no has pedido días') : 'Nada con ese estado',
          descripcion: filtro === 'todas' ? 'Elige los días en el calendario: arrastra o pulsa el primero y el último.' : undefined,
          accion: onPedir && filtro === 'todas' ? { texto: 'Pedir días', onClick: onPedir } : undefined,
          acento: 'personas',
        }}
      />

      <Confirmacion
        abierto={!!anulando}
        onCambio={(a) => !a && setAnulando(null)}
        titulo={anulando?.status === 'aprobada' ? 'Anular vacaciones aprobadas' : anulando && esMia(anulando) ? 'Retirar tu petición' : 'Anular la petición'}
        descripcion={anulando ? `${formatDayRange(anulando.start_date, anulando.end_date)} · ${formatDays(Number(anulando.working_days))}. Los días vuelven al saldo.` : undefined}
        palabra={null}
        tono="peligro"
        textoConfirmar={anulando?.status === 'aprobada' ? 'Anular' : 'Retirar'}
        onConfirmar={async () => {
          if (!anulando) return
          const r = await postVacations(`/api/vacations/${anulando.id}/cancel`, { reason: motivo.trim() || undefined })
          if (!r.ok) {
            toast.error(r.error)
            throw new Error(r.error)
          }
          toast.success(r.data.message ?? 'Hecho')
          setAnulando(null)
          onHecho()
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-[var(--ls-t3)]">Motivo {anulando && !esMia(anulando) ? '(lo leerá en su campana)' : '(opcional)'}</span>
          <textarea
            rows={2}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value.slice(0, 500))}
            className="resize-none rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 py-2 text-[14px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc-graf)]"
          />
        </label>
      </Confirmacion>
    </div>
  )
}

function Detalle({ r, datos, esAdmin }: { r: VacationRequest; datos: VacationsServerData; esAdmin: boolean }) {
  const lineas: string[] = []
  if (r.reason) lineas.push(`«${r.reason}»`)
  if (r.status === 'rechazada' && r.rejection_reason) lineas.push(`Denegada: ${r.rejection_reason}`)
  if (r.solape_autorizado && r.solape_motivo && esAdmin) lineas.push(`Excepción: ${r.solape_motivo}`)
  const firma = r.status === 'aprobada' || r.status === 'rechazada' ? resolvedBy(r, datos.people) : null
  if (firma) lineas.push(`${r.status === 'aprobada' ? 'Aprobó' : 'Denegó'} ${firma}`)
  if (r.status === 'cancelada') {
    const quien = cancelledBy(r, datos.people)
    lineas.push(`Anulada${quien ? ` por ${quien}` : ''}${r.cancel_reason ? `: ${r.cancel_reason}` : ''}`)
  }
  if (lineas.length === 0) return <span className="text-[var(--ls-t4)]">—</span>
  return (
    <span className="flex flex-col gap-0.5 text-[12.5px] leading-snug text-[var(--ls-t3)]">
      {lineas.map((l) => (
        <span key={l} className="line-clamp-2">{l}</span>
      ))}
    </span>
  )
}
