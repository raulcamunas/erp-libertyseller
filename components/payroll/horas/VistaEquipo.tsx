'use client'

import { useMemo } from 'react'
import { AlertTriangle, Clock, Users, Wallet } from 'lucide-react'
import { Avatar, FilaDeKpis, Insignia, Kpi, TablaAdaptable, VIZ, type Columna } from '@/components/ui-ls'
import { formatDollars, type ManualAppointment, type PayrollRate, type WorkHourEntry } from '@/lib/types/payroll'
import { formatoHoras, resumenDelEquipo, type FilaDeEquipo } from '@/lib/payroll/horas'
import type { CalendarPerson } from '@/lib/types/appointments'
import type { QualifiedAppointment } from './tipos'

const dolares = (n: number) => formatDollars(Math.round(n * 100) / 100)

/** Una barrita relativa al máximo del equipo, para comparar de un vistazo */
function Barrita({ valor, maximo }: { valor: number; maximo: number }) {
  const p = maximo > 0 ? Math.min(1, valor / maximo) : 0
  return (
    <span aria-hidden className="mt-1 block h-1 w-full max-w-[120px] overflow-hidden rounded-full bg-[var(--ls-sup3)]">
      <span className="block h-full rounded-full bg-[var(--ls-acc-graf)]" style={{ width: `${p * 100}%` }} />
    </span>
  )
}

/**
 * LA PESTAÑA «EQUIPO»: una fila por comercial con las horas, los días, las citas y el total del ciclo, calculados con
 * cycleCostForUser (el motor de la nómina, Empleados y Tesorería: cuadra con lo que se paga). Avisa de quién no ha
 * apuntado hoy. Al pulsar a alguien se abre su calendario.
 *
 * Sin ser admin (supervisor del equipo comercial) se ven SOLO las horas: ni citas ni dinero. Las citas que le llegan del
 * servidor son solo las suyas, así que ahí saldrían ceros que no son ceros; y el dinero no le corresponde.
 */
export function VistaEquipo({
  equipo,
  hours,
  rates,
  appointments,
  manual,
  claveCiclo,
  dias,
  hoy,
  esAdmin,
  onAbrirPersona,
}: {
  equipo: CalendarPerson[]
  hours: WorkHourEntry[]
  rates: PayrollRate[]
  appointments: QualifiedAppointment[]
  manual: ManualAppointment[]
  claveCiclo: string
  dias: string[]
  hoy: string
  esAdmin: boolean
  onAbrirPersona: (id: string) => void
}) {
  const filas = useMemo(
    () =>
      resumenDelEquipo(
        equipo.map((p) => ({ id: p.id, nombre: p.full_name || p.email || 'Sin nombre' })),
        { hours, rates, qualified: esAdmin ? appointments : [], manual: esAdmin ? manual : [] },
        claveCiclo,
        dias,
        hoy,
      ),
    [equipo, hours, rates, appointments, manual, claveCiclo, dias, hoy, esAdmin],
  )

  const cicloEnCurso = dias.includes(hoy)
  const maxHoras = Math.max(0, ...filas.map((f) => f.horas))
  const maxTotal = Math.max(0, ...filas.map((f) => f.total))
  const horasEquipo = filas.reduce((s, f) => s + f.horas, 0)
  const costeEquipo = filas.reduce((s, f) => s + f.total, 0)
  const sinApuntar = filas.filter((f) => f.sinApuntarHoy)

  const columnas: Columna<FilaDeEquipo>[] = [
    {
      id: 'nombre',
      cabecera: 'Persona',
      movil: 'titulo',
      ordenar: (f) => f.nombre,
      celda: (f) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar nombre={f.nombre} tamano={30} />
          <span className="truncate font-medium text-[var(--ls-t1)]">{f.nombre}</span>
        </span>
      ),
    },
    ...(cicloEnCurso
      ? [
          {
            id: 'hoy',
            cabecera: 'Hoy',
            movil: 'insignia' as const,
            ordenar: (f: FilaDeEquipo) => f.horasHoy,
            celda: (f: FilaDeEquipo) =>
              f.horasHoy > 0 ? (
                <Insignia tono="verde" tamano="sm">{formatoHoras(f.horasHoy)} h hoy</Insignia>
              ) : f.sinApuntarHoy ? (
                <Insignia tono="ambar" tamano="sm" icono={AlertTriangle}>No ha apuntado hoy</Insignia>
              ) : (
                <span className="text-[12px] text-[var(--ls-t4)]">—</span>
              ),
          },
        ]
      : []),
    {
      id: 'horas',
      cabecera: 'Horas',
      alinear: 'derecha',
      ordenar: (f) => f.horas,
      celda: (f) => (
        <span className="inline-flex flex-col items-end">
          <span className="tabular-nums">{formatoHoras(Math.round(f.horas * 100) / 100)} h</span>
          <Barrita valor={f.horas} maximo={maxHoras} />
        </span>
      ),
    },
    { id: 'dias', cabecera: 'Días', alinear: 'derecha', ordenar: (f) => f.dias, celda: (f) => <span className="tabular-nums">{f.dias}</span> },
    ...(esAdmin
      ? [
          { id: 'citas', cabecera: 'Citas', alinear: 'derecha' as const, ordenar: (f: FilaDeEquipo) => f.citas, celda: (f: FilaDeEquipo) => <span className="tabular-nums">{f.citas}</span> },
          {
            id: 'total',
            cabecera: 'Total del ciclo',
            alinear: 'derecha' as const,
            ordenar: (f: FilaDeEquipo) => f.total,
            celda: (f: FilaDeEquipo) => (
              <span className="inline-flex flex-col items-end" title={`Salario ${dolares(f.salario)} · comisiones ${dolares(f.comisiones)}`}>
                <span className="font-semibold tabular-nums text-[var(--ls-t1)]">{dolares(f.total)}</span>
                <Barrita valor={f.total} maximo={maxTotal} />
              </span>
            ),
          },
        ]
      : []),
  ]

  return (
    <div>
      <FilaDeKpis className="mb-4">
        <Kpi indice={0} etiqueta="Personas" icono={Users} acento="neutro" valor={filas.length} nota="del equipo comercial" />
        <Kpi indice={1} etiqueta="Horas del equipo" icono={Clock} acento="marca" valor={horasEquipo} formato={(n) => `${formatoHoras(Math.round(n * 10) / 10)} h`} nota="en este ciclo" />
        {esAdmin && <Kpi indice={2} etiqueta="Coste del ciclo" icono={Wallet} acento={VIZ[0]} valor={costeEquipo} formato={dolares} nota="salario + comisiones, como la nómina" />}
        {cicloEnCurso && (
          <Kpi
            indice={3}
            etiqueta="Sin apuntar hoy"
            icono={AlertTriangle}
            acento={sinApuntar.length ? 'cumplimiento' : 'cuentas'}
            valor={sinApuntar.length}
            nota={sinApuntar.length ? sinApuntar.map((f) => f.nombre.split(' ')[0]).join(', ') : 'Todo el mundo al día'}
          />
        )}
      </FilaDeKpis>

      <TablaAdaptable
        etiqueta="Horas del equipo en el ciclo"
        columnas={columnas}
        filas={filas}
        claveDe={(f) => f.userId}
        alPulsarFila={(f) => onAbrirPersona(f.userId)}
        ordenInicial={{ id: esAdmin ? 'total' : 'horas', sentido: 'desc' }}
        vacio={{ icono: Users, titulo: 'No hay comerciales', descripcion: 'Marca a alguien como comercial en Usuarios para verle aquí.' }}
      />
      <p className="mt-2 text-[12px] text-[var(--ls-t4)]">Pulsa a una persona para abrir su calendario{esAdmin ? ' y corregir sus horas' : ''}.</p>
    </div>
  )
}
