'use client'

import { useEffect, useMemo, useState } from 'react'
import { Minus, Palette, Plus, Save, Settings2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Boton, Insignia, PanelLateral, TablaAdaptable, Tarjeta, mezcla, type Columna } from '@/components/ui-ls'
import type { VacationsServerData } from '@/lib/employees/vacations'
import { vacationBalance, type VacationBalance, type VacationEmployee } from '@/lib/types/vacations'
import { colorDePersona, festivosDelLugar, PALETA_PERSONAS } from '@/lib/vacations/calendario'
import { postVacations } from '@/lib/vacations/client'
import { CCAA, CODIGOS_CCAA, type CodigoCcaa } from '@/lib/ubicacion/zonas'
import { cn } from '@/lib/utils'
import { AvatarDePersona } from './AvatarDePersona'
import { numeroDeDias } from './modelo'

interface Fila {
  empleado: VacationEmployee
  saldo: VacationBalance | null
  color: string
  ccaa: CodigoCcaa | null
}

/**
 * EQUIPO (solo admin): el saldo de cada persona con las reglas de siempre (no se cambian, solo se enseñan), y los ajustes
 * nuevos de la 308: cuántos pueden estar fuera a la vez, el color de cada uno en el calendario y dónde viven para sus
 * festivos. La tarifa (días por mes) y la fecha de alta siguen en la ficha de Control empleados.
 */
export function EquipoYAjustes({ datos, onHecho }: { datos: VacationsServerData; onHecho: () => void }) {
  const [max, setMax] = useState(datos.maxALaVez)
  const [guardandoMax, setGuardandoMax] = useState(false)
  const [editando, setEditando] = useState<Fila | null>(null)

  useEffect(() => setMax(datos.maxALaVez), [datos.maxALaVez])

  const filas: Fila[] = useMemo(
    () =>
      datos.employees
        .filter((e) => e.is_active || e.vacation_days_per_month != null)
        .map((e) => {
          const ficha = datos.fichas[e.id]
          return {
            empleado: e,
            saldo: e.vacation_days_per_month == null ? null : vacationBalance(e, datos.requests, datos.today, { holidays: festivosDelLugar(ficha?.lugar ?? null) }),
            color: ficha?.color ?? colorDePersona(e.id),
            ccaa: (ficha?.lugar?.ccaa as CodigoCcaa | undefined) ?? null,
          }
        }),
    [datos]
  )

  async function guardarMax() {
    setGuardandoMax(true)
    const r = await postVacations<{ message?: string }>('/api/vacations/ajustes', { maxALaVez: max })
    setGuardandoMax(false)
    if (!r.ok) return toast.error(r.error)
    toast.success(r.data.message ?? 'Guardado')
    onHecho()
  }

  const n = (v: number | undefined) => (v == null ? '—' : numeroDeDias(v))
  const columnas: Columna<Fila>[] = [
    {
      id: 'persona',
      cabecera: 'Persona',
      movil: 'titulo',
      ordenar: (f) => f.empleado.name,
      celda: (f) => (
        <span className="flex min-w-0 items-center gap-2">
          <AvatarDePersona nombre={f.empleado.name} color={f.color} tamano={28} />
          <span className="truncate font-medium text-[var(--ls-t1)]">{f.empleado.name}</span>
          {!f.empleado.user_id && <Insignia tono="gris" tamano="sm" punto={false} title="No puede pedir ni recibir avisos: enlaza su usuario en Control empleados">Sin cuenta</Insignia>}
        </span>
      ),
    },
    {
      id: 'tarifa',
      cabecera: 'Genera',
      celda: (f) =>
        f.empleado.vacation_days_per_month == null ? (
          <Insignia tono="ambar" tamano="sm" title="Ponle los días por mes en su ficha de Control empleados">Sin tarifa</Insignia>
        ) : (
          <span className="tabular-nums">{numeroDeDias(f.empleado.vacation_days_per_month)} / mes</span>
        ),
    },
    { id: 'devengado', cabecera: 'Devengado', alinear: 'derecha', ordenar: (f) => f.saldo?.generated ?? -1, celda: (f) => <span className="tabular-nums">{n(f.saldo?.generated)}</span> },
    {
      id: 'arrastre',
      cabecera: 'Arrastre',
      alinear: 'derecha',
      celda: (f) =>
        f.saldo && f.saldo.carriedLeft > 0 ? (
          <span className="tabular-nums" style={{ color: 'var(--ls-e-ambar)' }} title="Caduca el 31 de marzo">{numeroDeDias(f.saldo.carriedLeft)}</span>
        ) : f.saldo && f.saldo.debt > 0 ? (
          <span className="tabular-nums" style={{ color: 'var(--ls-e-rojo)' }} title="Deuda del año anterior">−{numeroDeDias(f.saldo.debt)}</span>
        ) : (
          <span className="text-[var(--ls-t4)]">—</span>
        ),
    },
    { id: 'aprobados', cabecera: 'Aprobados', alinear: 'derecha', celda: (f) => <span className="tabular-nums">{n(f.saldo?.approved)}</span> },
    { id: 'pendientes', cabecera: 'Pendientes', alinear: 'derecha', celda: (f) => <span className="tabular-nums">{n(f.saldo?.pending)}</span> },
    {
      id: 'disponibles',
      cabecera: 'Disponibles',
      alinear: 'derecha',
      movil: 'insignia',
      ordenar: (f) => f.saldo?.available ?? -999,
      celda: (f) => (
        <span className={cn('text-[15px] font-semibold tabular-nums', f.saldo && f.saldo.available < 0 ? 'text-[var(--ls-e-rojo)]' : 'text-[var(--ls-t1)]')}>{n(f.saldo?.available)}</span>
      ),
    },
    {
      id: 'festivos',
      cabecera: 'Festivos',
      rotuloMovil: 'Festivos',
      celda: (f) => <span className="text-[var(--ls-t3)]">{f.ccaa ? CCAA[f.ccaa].corto : 'Solo fines de semana'}</span>,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <Tarjeta icono={Settings2} acento="personas" titulo="Regla de la empresa" subtitulo="Cuántas personas pueden estar fuera el mismo día. Si se pasa, la petición se puede pedir con aviso y tú decides al aprobar.">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center rounded-[12px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] p-1">
            <Boton variante="fantasma" soloIcono icono={Minus} aria-label="Una menos" disabled={max <= 1 || !datos.migracion308} onClick={() => setMax((m) => Math.max(1, m - 1))} />
            <span className="min-w-[3rem] text-center text-[22px] font-semibold tabular-nums text-[var(--ls-t1)]">{max}</span>
            <Boton variante="fantasma" soloIcono icono={Plus} aria-label="Una más" disabled={max >= 50 || !datos.migracion308} onClick={() => setMax((m) => Math.min(50, m + 1))} />
          </div>
          <span className="text-[13px] text-[var(--ls-t3)]">{max === 1 ? 'No pueden irse dos a la vez' : `Hasta ${max} personas fuera a la vez`}</span>
          <Boton className="ml-auto" variante="primario" icono={Save} cargando={guardandoMax} disabled={max === datos.maxALaVez || !datos.migracion308} onClick={guardarMax}>Guardar</Boton>
        </div>
        {!datos.migracion308 && <p className="mt-3 text-[12.5px]" style={{ color: 'var(--ls-e-ambar)' }}>Falta lanzar la migración 308 en Supabase: hasta entonces el máximo es 1 y no se pueden cambiar colores ni festivos.</p>}
      </Tarjeta>

      <Tarjeta icono={Users} acento="personas" titulo="Saldos del equipo" subtitulo="Año natural. Las reglas no cambian: días por mes completo trabajado, lo que sobra se arrastra y caduca el 31 de marzo, y lo pendiente ya resta. Pulsa una persona para su color y sus festivos." sinRelleno>
        <TablaAdaptable etiqueta="Saldos del equipo" columnas={columnas} filas={filas} claveDe={(f) => f.empleado.id} alPulsarFila={(f) => setEditando(f)} porPagina={0} ordenInicial={{ id: 'persona', sentido: 'asc' }} />
      </Tarjeta>

      <EditarPersona fila={editando} onCerrar={() => setEditando(null)} activo={datos.migracion308} onHecho={onHecho} />
    </div>
  )
}

function EditarPersona({ fila, onCerrar, activo, onHecho }: { fila: Fila | null; onCerrar: () => void; activo: boolean; onHecho: () => void }) {
  const [color, setColor] = useState<string>('')
  const [ccaa, setCcaa] = useState<string>('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (fila) {
      setColor(fila.color)
      setCcaa(fila.ccaa ?? '')
    }
  }, [fila])

  async function guardar() {
    if (!fila) return
    setGuardando(true)
    const r = await postVacations<{ message?: string }>('/api/vacations/ajustes', { ficha: { id: fila.empleado.id, color, lugar: ccaa ? { ccaa } : null } })
    setGuardando(false)
    if (!r.ok) return toast.error(r.error)
    toast.success(`${fila.empleado.name}: guardado`)
    onCerrar()
    onHecho()
  }

  return (
    <PanelLateral
      abierto={!!fila}
      onCambio={(a) => !a && onCerrar()}
      titulo={fila?.empleado.name ?? ''}
      descripcion="Color en el calendario y festivos que no le gastan vacaciones"
      icono={Palette}
      acento="personas"
      pie={
        <>
          <Boton variante="secundario" onClick={onCerrar}>Cancelar</Boton>
          <Boton variante="primario" icono={Save} cargando={guardando} disabled={!activo} onClick={guardar}>Guardar</Boton>
        </>
      }
    >
      {fila && (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3 rounded-[14px] border border-[var(--ls-linea)] p-3" style={{ background: mezcla(color || fila.color, 8) }}>
            <AvatarDePersona nombre={fila.empleado.name} color={color || fila.color} tamano={44} />
            <span className="text-[13px] text-[var(--ls-t2)]">Así se verá en el calendario de todos.</span>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-[12.5px] font-medium text-[var(--ls-t3)]">Color</legend>
            <div className="flex flex-wrap gap-2">
              {PALETA_PERSONAS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  aria-pressed={color.toLowerCase() === c.toLowerCase()}
                  onClick={() => setColor(c)}
                  className={cn('h-9 w-9 rounded-full outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11', color.toLowerCase() === c.toLowerCase() && 'ring-2 ring-[var(--ls-t1)] ring-offset-2 ring-offset-[var(--ls-sup)]')}
                  style={{ background: c }}
                />
              ))}
            </div>
          </fieldset>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-[var(--ls-t3)]">Festivos (dónde vive)</span>
            <select
              value={ccaa}
              onChange={(e) => setCcaa(e.target.value)}
              className="h-10 rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 text-[14px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc-graf)]"
            >
              <option value="">Fuera de España / solo fines de semana</option>
              {CODIGOS_CCAA.map((c) => (
                <option key={c} value={c}>{CCAA[c].nombre}</option>
              ))}
            </select>
            <span className="text-[12px] leading-relaxed text-[var(--ls-t4)]">
              Con una comunidad, sus festivos (los de toda España y los de la comunidad) no le gastan días. Las vacaciones ya aprobadas conservan los días con que se aprobaron.
            </span>
          </label>
          {!activo && <p className="text-[12.5px]" style={{ color: 'var(--ls-e-ambar)' }}>Falta lanzar la migración 308 en Supabase.</p>}
        </div>
      )}
    </PanelLateral>
  )
}
