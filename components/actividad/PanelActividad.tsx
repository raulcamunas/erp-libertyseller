'use client'

import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Avatar, BarraDeCarga, CabeceraDePanel, Esqueleto, PANEL } from '@/components/rendimiento/ui'
import { duracion, etiquetaDeFecha, fechaCorta, fechaDeMs, finDelDiaMs, horaDeMs, inicioDelDiaMs, sumarDias, ZONAS, zonaValida } from '@/lib/actividad/dia'
import type { FilaDelEquipo, RespuestaEquipo, RespuestaPersona, RespuestaSinMigracion } from '@/lib/actividad/tipos'
import { DetalleDePersona } from './DetalleDePersona'

/**
 * LA PANTALLA DE ACTIVIDAD: el día de todo el equipo y, al pulsar a una persona, el suyo minuto a minuto.
 *
 * Todo se lee de /api/actividad/equipo y /persona (solo administradores y quien tenga la casilla). El día es de medianoche a
 * medianoche en la ZONA elegida (por defecto la del navegador de quien mira) y las horas se enseñan en esa zona. Hoy se
 * refresca solo cada minuto.
 */

const CLAVE_DE_ZONA = 'actividad:zona'
/** Una persona cuya última señal es de hace menos de esto está «en línea» */
const EN_LINEA_MS = 3 * 60_000

const celda = 'px-3 py-2 align-middle'
const cabecera = 'px-3 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.04em] text-[var(--ls-t4)]'

export function PanelActividad() {
  const [zona, setZona] = useState('America/Bogota')
  const [fecha, setFecha] = useState<string | null>(null)
  const [equipo, setEquipo] = useState<RespuestaEquipo | null>(null)
  const [persona, setPersona] = useState<RespuestaPersona | null>(null)
  const [personaId, setPersonaId] = useState<string | null>(null)
  const [cargandoEquipo, setCargandoEquipo] = useState(false)
  const [cargandoPersona, setCargandoPersona] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [faltaMigracion, setFaltaMigracion] = useState(false)
  const turnoEquipo = useRef(0)
  const turnoPersona = useRef(0)

  // La zona y el día de hoy se resuelven en el navegador (el servidor no sabe en qué zona mira quien mira)
  useEffect(() => {
    let z = ''
    try {
      z = window.localStorage.getItem(CLAVE_DE_ZONA) ?? ''
    } catch {
      // sin almacenamiento: se usa la del navegador
    }
    if (!zonaValida(z)) z = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!zonaValida(z)) z = 'America/Bogota'
    setZona(z)
    setFecha(fechaDeMs(Date.now(), z))
  }, [])

  const cargarEquipo = useCallback(async (f: string, z: string, silencioso: boolean) => {
    const mio = ++turnoEquipo.current
    if (!silencioso) setCargandoEquipo(true)
    try {
      const r = await fetch(`/api/actividad/equipo?desde=${inicioDelDiaMs(f, z)}&hasta=${finDelDiaMs(f, z)}`, { cache: 'no-store' })
      if (mio !== turnoEquipo.current) return
      if (!r.ok) throw new Error(String(r.status))
      const j = (await r.json()) as RespuestaEquipo | RespuestaSinMigracion
      if (mio !== turnoEquipo.current) return
      if ('faltaMigracion' in j) {
        setFaltaMigracion(true)
        setEquipo(null)
      } else {
        setFaltaMigracion(false)
        setEquipo(j)
      }
      setError(null)
    } catch {
      if (mio === turnoEquipo.current) setError('No se ha podido leer la actividad. Se vuelve a intentar en un minuto.')
    } finally {
      if (mio === turnoEquipo.current) setCargandoEquipo(false)
    }
  }, [])

  const cargarPersona = useCallback(async (id: string, f: string, z: string, silencioso: boolean) => {
    const mio = ++turnoPersona.current
    if (!silencioso) setCargandoPersona(true)
    try {
      const r = await fetch(`/api/actividad/persona?id=${id}&desde=${inicioDelDiaMs(f, z)}&hasta=${finDelDiaMs(f, z)}`, { cache: 'no-store' })
      if (mio !== turnoPersona.current) return
      if (!r.ok) throw new Error(String(r.status))
      const j = (await r.json()) as RespuestaPersona | RespuestaSinMigracion
      if (mio !== turnoPersona.current) return
      if ('faltaMigracion' in j) {
        setPersona(null)
      } else {
        setPersona(j)
      }
    } catch {
      if (mio === turnoPersona.current) setError('No se ha podido leer el día de esa persona. Vuelve a probar en un momento.')
    } finally {
      if (mio === turnoPersona.current) setCargandoPersona(false)
    }
  }, [])

  useEffect(() => {
    if (fecha) void cargarEquipo(fecha, zona, false)
  }, [fecha, zona, cargarEquipo])

  useEffect(() => {
    if (fecha && personaId) void cargarPersona(personaId, fecha, zona, false)
    else setPersona(null)
  }, [personaId, fecha, zona, cargarPersona])

  // El día de hoy se mueve: se vuelve a leer cada minuto mientras la pestaña esté a la vista
  useEffect(() => {
    if (!fecha) return
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (fecha !== fechaDeMs(Date.now(), zona)) return
      void cargarEquipo(fecha, zona, true)
      if (personaId) void cargarPersona(personaId, fecha, zona, true)
    }, 60_000)
    return () => window.clearInterval(id)
  }, [fecha, zona, personaId, cargarEquipo, cargarPersona])

  const hoy = fecha ? fechaDeMs(Date.now(), zona) : ''
  const esHoy = fecha !== null && fecha === hoy

  const opcionesDeZona = useMemo(() => {
    const base = ZONAS.map((z) => ({ id: z.id, nombre: z.nombre }))
    return base.some((z) => z.id === zona) ? base : [{ id: zona, nombre: `Tu zona (${zona})` }, ...base]
  }, [zona])

  const filas = useMemo(() => {
    const lista = [...(equipo?.filas ?? [])]
    // Quien ha hecho algo primero, de más a menos tiempo activo; después los que no han entrado
    return lista.sort((a, b) => Number(b.primera !== null) - Number(a.primera !== null) || b.minutosActivos - a.minutosActivos || a.nombre.localeCompare(b.nombre, 'es'))
  }, [equipo])

  const resumen = useMemo(() => {
    const con = filas.filter((f) => f.primera !== null)
    const media = con.length > 0 ? Math.round(con.reduce((n, f) => n + f.minutosActivos, 0) / con.length) : 0
    return { total: filas.length, entraron: con.length, media }
  }, [filas])

  const cambiarZona = (z: string) => {
    if (!zonaValida(z)) return
    try {
      window.localStorage.setItem(CLAVE_DE_ZONA, z)
    } catch {
      // da igual
    }
    // El mismo día de calendario en la zona nueva
    setZona(z)
  }

  if (fecha === null) {
    return (
      <div className="space-y-3">
        <Esqueleto className="h-9 w-full max-w-xl" />
        <Esqueleto className="h-64 w-full" />
      </div>
    )
  }

  if (faltaMigracion) {
    return (
      <div className="flex items-start gap-3 rounded-[10px] border border-l-2 border-[var(--ls-linea)] border-l-[var(--ls-e-ambar)] bg-[var(--ls-sup)] p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ls-e-ambar)]" />
        <div className="text-[13px] leading-relaxed text-[var(--ls-t2)]">
          <p className="mb-1 font-semibold text-[var(--ls-t1)]">Falta lanzar la migración del registro de actividad</p>
          <p>
            Pega el contenido de <span className="font-mono text-[12px]">240_actividad_registro.sql</span> en el editor SQL de Supabase. Hasta entonces no se guarda nada y esta pantalla está vacía.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* El día, la zona y el refresco */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => setFecha(sumarDias(fecha, -1))}
            aria-label="Día anterior"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <input
            type="date"
            value={fecha}
            max={hoy}
            onChange={(e) => e.target.value && setFecha(e.target.value)}
            aria-label="Día"
            className="h-8 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-2 text-[12.5px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc-graf)]"
          />
          <button
            type="button"
            onClick={() => setFecha(sumarDias(fecha, 1))}
            disabled={esHoy}
            aria-label="Día siguiente"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)] disabled:opacity-35"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setFecha(hoy)}
            disabled={esHoy}
            className="ml-1 h-8 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 text-[12.5px] text-[var(--ls-t2)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)] disabled:opacity-35"
          >
            Hoy
          </button>
        </div>
        <label className="ml-auto inline-flex items-center gap-2 text-[11.5px] text-[var(--ls-t4)]">
          Horas en
          <select
            value={zona}
            onChange={(e) => cambiarZona(e.target.value)}
            className="h-8 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-2 text-[12.5px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc-graf)]"
          >
            {opcionesDeZona.map((z) => (
              <option key={z.id} value={z.id}>
                {z.nombre}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            void cargarEquipo(fecha, zona, false)
            if (personaId) void cargarPersona(personaId, fecha, zona, false)
          }}
          aria-label="Actualizar"
          title="Actualizar"
          className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${cargandoEquipo ? 'animate-spin' : ''}`} aria-hidden />
        </button>
      </div>

      {error && (
        <p className="flex items-center gap-2 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-2 text-[12.5px] text-[var(--ls-e-ambar)]" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> {error}
        </p>
      )}

      {/* El equipo, ese día */}
      <section className={`${PANEL} relative overflow-hidden`}>
        <CabeceraDePanel
          titulo="Equipo"
          contexto={`· ${etiquetaDeFecha(fecha)}`}
          derecha={
            equipo ? (
              <span className="text-[11px] text-[var(--ls-t4)]">
                {resumen.entraron} de {resumen.total} han entrado{resumen.entraron > 0 ? ` · activo de media ${duracion(resumen.media)}` : ''}
              </span>
            ) : undefined
          }
        />
        <BarraDeCarga activa={cargandoEquipo} />
        {!equipo ? (
          <div className="space-y-2 p-3">
            <Esqueleto className="h-8 w-full" />
            <Esqueleto className="h-8 w-full" />
            <Esqueleto className="h-8 w-full" />
          </div>
        ) : filas.length === 0 ? (
          <p className="px-3 py-6 text-[13px] text-[var(--ls-t4)]">No hay empleados a los que registrar.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-[var(--ls-linea)] bg-[var(--ls-sup2)]">
                  <th className={cabecera}>Persona</th>
                  <th className={cabecera}>Entró</th>
                  <th className={cabecera}>Última actividad</th>
                  <th className={cabecera}>Tiempo activo</th>
                  <th className={`${cabecera} text-right`}>Pantallas</th>
                  <th className={`${cabecera} text-right`}>Clics</th>
                  <th className={cabecera}>Último inicio de sesión</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <FilaDeEquipo key={f.id} f={f} zona={zona} hoy={hoy} esHoy={esHoy} ahora={equipo.ahora} seleccionada={f.id === personaId} alElegir={() => setPersonaId(f.id === personaId ? null : f.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-[var(--ls-linea)] px-3 py-2 text-[11px] leading-snug text-[var(--ls-t4)]">
          «Activo» son los minutos con la pestaña a la vista y algo de ratón o teclado en los dos minutos anteriores. Solo cuenta lo que se hace dentro del ERP. Pulsa a una persona para ver su día.
        </p>
      </section>

      {personaId && (
        <DetalleDePersona
          datos={persona && persona.persona.id === personaId ? persona : null}
          cargando={cargandoPersona}
          zona={zona}
          esHoy={esHoy}
          hoy={hoy}
          alCerrar={() => setPersonaId(null)}
        />
      )}
    </div>
  )
}

function FilaDeEquipo({
  f,
  zona,
  hoy,
  esHoy,
  ahora,
  seleccionada,
  alElegir,
}: {
  f: FilaDelEquipo
  zona: string
  hoy: string
  esHoy: boolean
  ahora: number
  seleccionada: boolean
  alElegir: () => void
}) {
  const hizoAlgo = f.primera !== null
  const enLinea = esHoy && f.ultima !== null && ahora - f.ultima <= EN_LINEA_MS
  return (
    <tr
      onClick={alElegir}
      className={`cursor-pointer border-b border-[var(--ls-linea)] transition-colors last:border-b-0 ${seleccionada ? 'bg-[var(--ls-sup3)]' : 'hover:bg-[var(--ls-sup3)]'}`}
    >
      <td className={celda}>
        <button
          type="button"
          onClick={(e) => {
            // La fila entera también elige: sin esto el clic subiría hasta ella y elegir y deselegir se anularían
            e.stopPropagation()
            alElegir()
          }}
          aria-pressed={seleccionada}
          className="flex items-center gap-2 text-left outline-none focus-visible:underline"
        >
          <Avatar id={f.id} nombre={f.nombre} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-[var(--ls-t1)]">{f.nombre}</span>
            {f.comercial && <span className="block text-[10.5px] text-[var(--ls-t4)]">Comercial</span>}
          </span>
        </button>
      </td>
      <td className={`${celda} tabular-nums text-[var(--ls-t2)]`}>{hizoAlgo ? horaDeMs(f.primera!, zona) : <span className="text-[var(--ls-t4)]">—</span>}</td>
      <td className={`${celda} tabular-nums text-[var(--ls-t2)]`}>
        {hizoAlgo ? (
          <span className="inline-flex items-center gap-1.5">
            {horaDeMs(f.ultima!, zona)}
            {enLinea && (
              <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ls-e-verde)]">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--ls-e-verde)]" /> en línea
              </span>
            )}
          </span>
        ) : (
          <span className="text-[var(--ls-t4)]">{esHoy ? 'Todavía no ha entrado' : 'No entró'}</span>
        )}
      </td>
      <td className={celda}>
        {hizoAlgo ? (
          <span className="flex items-center gap-2">
            <span className="w-[68px] tabular-nums text-[var(--ls-t1)]">{duracion(f.minutosActivos)}</span>
            <span aria-hidden className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--ls-sup3)]">
              <span className="block h-full rounded-full bg-[var(--ls-acc-graf)]" style={{ width: `${Math.min(100, (f.minutosActivos / 480) * 100)}%` }} />
            </span>
          </span>
        ) : (
          <span className="text-[var(--ls-t4)]">—</span>
        )}
      </td>
      <td className={`${celda} text-right tabular-nums text-[var(--ls-t2)]`}>{hizoAlgo ? f.paginas : '—'}</td>
      <td className={`${celda} text-right tabular-nums text-[var(--ls-t2)]`}>{hizoAlgo ? f.clics : '—'}</td>
      <td className={`${celda} tabular-nums text-[var(--ls-t3)]`}>{f.ultimoLogin ? fechaCorta(f.ultimoLogin, zona, hoy) : '—'}</td>
    </tr>
  )
}
