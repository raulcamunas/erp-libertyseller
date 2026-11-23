'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarPlus, SlidersHorizontal, Trash2 } from 'lucide-react'
import { Boton, Confirmacion, Tarjeta } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { AGENTE, CLASES_SIN_TOPE, TOPES_DE_PARTIDA, type ClaseDeTope, type EventoDeTemporada, type PanelDelAgente, type TopesDelAgente as Topes } from '@/lib/ads/agente/tipos'
import { CAMPO_AGENTE, NOMBRE_DE_CLASE, type Accion } from './TarjetaDeEstado'

const CLASES = Object.keys(TOPES_DE_PARTIDA) as ClaseDeTope[]
const TOPE_MAX = 200

type EventoEnEdicion = { nombre: string; desde: string; hasta: string; paises: string }

const aTexto = (t: Topes): Record<ClaseDeTope, string> => Object.fromEntries(CLASES.map((c) => [c, String(t[c] ?? TOPES_DE_PARTIDA[c])])) as Record<ClaseDeTope, string>
const aEdicion = (e: readonly EventoDeTemporada[]): EventoEnEdicion[] => e.map((x) => ({ nombre: x.nombre, desde: x.desde, hasta: x.hasta, paises: (x.paises ?? []).join(', ') }))
const FECHA = /^\d{4}-\d{2}-\d{2}$/

/**
 * LOS TOPES DEL AGENTE (solo administradores): cuántos cambios de cada clase puede hacer al día —con los de HOY al lado, que la rampa y la cuenta pequeña recortan—, el tope de gasto
 * en IA del mes, la puja máxima de la cuenta y la temporada (eventos que Amazon anuncia con poco margen, como Prime Day, y si en los meses de evento el techo puede subir un 30 %).
 */
export function TopesDelAgente({ panel, moneda, accion }: { panel: PanelDelAgente; moneda: string | null; accion: Accion }) {
  const c = panel.config
  const [topes, setTopes] = useState(() => aTexto(panel.topes))
  const [topeIa, setTopeIa] = useState(() => String(c?.topeIaUsdMes ?? AGENTE.IA_TOPE_USD_MES))
  const [pujaMax, setPujaMax] = useState(() => (c?.pujaMax != null ? String(c.pujaMax) : ''))
  const [eventos, setEventos] = useState<EventoEnEdicion[]>(() => aEdicion(c?.eventosManuales ?? []))
  const [pico, setPico] = useState(() => c?.picoEventos ?? false)
  const [confirmar, setConfirmar] = useState<null | 'topes' | 'temporada'>(null)

  // Lo guardado cambia (otra persona, o tras guardar): se vuelve a cargar en el formulario
  const firmaTopes = JSON.stringify([panel.topes, c?.topeIaUsdMes, c?.pujaMax])
  const firmaTemporada = JSON.stringify([c?.eventosManuales, c?.picoEventos])
  useEffect(() => {
    setTopes(aTexto(panel.topes))
    setTopeIa(String(c?.topeIaUsdMes ?? AGENTE.IA_TOPE_USD_MES))
    setPujaMax(c?.pujaMax != null ? String(c.pujaMax) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmaTopes])
  useEffect(() => {
    setEventos(aEdicion(c?.eventosManuales ?? []))
    setPico(c?.picoEventos ?? false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmaTemporada])

  const num = (s: string) => Number(s.replace(',', '.'))
  const erroresTopes = useMemo(() => {
    const e: string[] = []
    for (const k of CLASES) {
      const n = num(topes[k])
      if (topes[k].trim() === '' || !Number.isInteger(n) || n < 0 || n > TOPE_MAX) e.push(`${NOMBRE_DE_CLASE[k]}: un número entero de 0 a ${TOPE_MAX}`)
    }
    const ia = num(topeIa)
    if (topeIa.trim() === '' || !Number.isFinite(ia) || ia < 0) e.push('Tope de IA: un importe de 0 o más')
    if (pujaMax.trim() !== '') {
      const p = num(pujaMax)
      if (!Number.isFinite(p) || p < AGENTE.PUJA_MINIMA) e.push(`Puja máxima: ${AGENTE.PUJA_MINIMA.toLocaleString('es-ES')} o más (vacío = ${AGENTE.PUJA_MAX_ABSOLUTA.toLocaleString('es-ES')})`)
    }
    return e
  }, [topes, topeIa, pujaMax])

  const erroresTemporada = useMemo(() => {
    const e: string[] = []
    eventos.forEach((x, i) => {
      if (!x.nombre.trim()) e.push(`Evento ${i + 1}: falta el nombre`)
      if (!FECHA.test(x.desde) || !FECHA.test(x.hasta)) e.push(`Evento ${i + 1}: faltan las fechas`)
      else if (x.hasta < x.desde) e.push(`Evento ${i + 1}: termina antes de empezar`)
    })
    return e
  }, [eventos])

  const guardarTopes = () =>
    accion(
      'PUT',
      { accion: 'topes', topes: Object.fromEntries(CLASES.map((k) => [k, num(topes[k])])), topeIaUsd: num(topeIa), pujaMax: pujaMax.trim() === '' ? null : num(pujaMax) },
      { exito: 'Topes guardados.' },
    )

  const guardarTemporada = () =>
    accion(
      'PUT',
      {
        accion: 'temporada',
        picoEventos: pico,
        eventosManuales: eventos.map((x) => {
          const paises = x.paises
            .split(/[,\s]+/)
            .map((p) => p.trim().toUpperCase())
            .filter(Boolean)
          return { nombre: x.nombre.trim(), desde: x.desde, hasta: x.hasta, paises: paises.length > 0 ? paises : null, veda: false }
        }),
      },
      { exito: 'Temporada guardada.' },
    )

  const cambiarEvento = (i: number, campo: keyof EventoEnEdicion, valor: string) => setEventos((l) => l.map((x, j) => (j === i ? { ...x, [campo]: valor } : x)))

  return (
    <Tarjeta acento="marketing" icono={SlidersHorizontal} titulo="Topes y temporada" subtitulo="Solo administradores. Los de hoy los recorta la rampa (y la cuenta pequeña).">
      {/* ---- topes por clase ---- */}
      <div className="grid gap-2 sm:grid-cols-2">
        {CLASES.map((k) => {
          const hoy = panel.topesHoy[k]
          const hechos = panel.hechosHoy[k] ?? 0
          const recortado = hoy != null && hoy < num(topes[k])
          if (CLASES_SIN_TOPE.has(k)) {
            return (
              <div key={k} className="flex min-w-0 items-center gap-3 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-[var(--ls-t1)]">{NOMBRE_DE_CLASE[k]}</span>
                  <span className="block text-[11.5px] tabular-nums text-[var(--ls-t4)]">hoy {hechos}</span>
                </span>
                <span className="shrink-0 text-[12px] font-medium text-[var(--ls-t3)]">Sin tope</span>
              </div>
            )
          }
          return (
            <label key={k} className="flex min-w-0 items-center gap-3 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium text-[var(--ls-t1)]">{NOMBRE_DE_CLASE[k]}</span>
                <span className="block text-[11.5px] tabular-nums text-[var(--ls-t4)]">
                  hoy {hechos} de <span style={{ color: recortado ? COLOR_ESTADO.ambar : undefined }}>{hoy ?? '—'}</span>
                  {recortado ? ' (rampa)' : ''}
                </span>
              </span>
              <input className={`${CAMPO_AGENTE} w-[76px] shrink-0 text-right tabular-nums`} inputMode="numeric" value={topes[k]} onChange={(e) => setTopes((t) => ({ ...t, [k]: e.target.value }))} aria-label={`Tope diario: ${NOMBRE_DE_CLASE[k]}`} />
            </label>
          )
        })}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[12px] font-semibold text-[var(--ls-t3)]">Tope de IA al mes (USD)</span>
          <input className={`${CAMPO_AGENTE} mt-1 tabular-nums`} inputMode="decimal" value={topeIa} onChange={(e) => setTopeIa(e.target.value)} />
          <span className="mt-1 block text-[11.5px] text-[var(--ls-t4)]">Al llegar, deja de llamar a la IA hasta el mes siguiente.</span>
        </label>
        <label className="block">
          <span className="text-[12px] font-semibold text-[var(--ls-t3)]">Puja máxima{moneda ? ` (${moneda})` : ''}</span>
          <input className={`${CAMPO_AGENTE} mt-1 tabular-nums`} inputMode="decimal" value={pujaMax} placeholder={`${AGENTE.PUJA_MAX_ABSOLUTA.toLocaleString('es-ES')} (por defecto)`} onChange={(e) => setPujaMax(e.target.value)} />
          <span className="mt-1 block text-[11.5px] text-[var(--ls-t4)]">Ninguna subida pasa de aquí (ni del precio × conversión × objetivo × 1,2).</span>
        </label>
      </div>

      {erroresTopes.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-[12px]" style={{ color: COLOR_ESTADO.ambar }}>
          {erroresTopes.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Boton variante="secundario" disabled={erroresTopes.length > 0} onClick={() => setConfirmar('topes')}>
          Guardar topes
        </Boton>
        <Boton variante="fantasma" onClick={() => setTopes(aTexto(TOPES_DE_PARTIDA))}>
          Volver a los de partida
        </Boton>
      </div>

      {/* ---- temporada ---- */}
      <div className="mt-5 border-t border-[var(--ls-linea)] pt-4">
        <div className="text-[13px] font-semibold text-[var(--ls-t1)]">Temporada</div>
        <p className="mt-1 text-[12px] text-[var(--ls-t3)]">Black Friday, Navidad y Reyes ya están. Añade los que Amazon anuncia con poco margen (Prime Day, Hot Sale…): en ellos el freno de gasto es más holgado y después no sube nada basándose en esos días.</p>

        <div className="mt-3 flex flex-col gap-2">
          {eventos.map((x, i) => (
            <div key={i} className="grid gap-2 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto]">
              <input className={CAMPO_AGENTE} value={x.nombre} maxLength={60} placeholder="Nombre (Prime Day)" aria-label={`Nombre del evento ${i + 1}`} onChange={(e) => cambiarEvento(i, 'nombre', e.target.value)} />
              <input className={CAMPO_AGENTE} type="date" value={x.desde} aria-label={`Desde (evento ${i + 1})`} onChange={(e) => cambiarEvento(i, 'desde', e.target.value)} />
              <input className={CAMPO_AGENTE} type="date" value={x.hasta} aria-label={`Hasta (evento ${i + 1})`} onChange={(e) => cambiarEvento(i, 'hasta', e.target.value)} />
              <input className={CAMPO_AGENTE} value={x.paises} placeholder="Países (vacío = todos)" aria-label={`Países del evento ${i + 1}`} onChange={(e) => cambiarEvento(i, 'paises', e.target.value)} />
              <Boton variante="fantasma" soloIcono icono={Trash2} aria-label={`Quitar el evento ${i + 1}`} onClick={() => setEventos((l) => l.filter((_, j) => j !== i))} />
            </div>
          ))}
          <div>
            <Boton variante="fantasma" tamano="sm" icono={CalendarPlus} onClick={() => setEventos((l) => [...l, { nombre: '', desde: '', hasta: '', paises: '' }])}>
              Añadir evento
            </Boton>
          </div>
        </div>

        <label className="mt-3 flex cursor-pointer items-start gap-2 text-[12.5px] text-[var(--ls-t2)] [@media(pointer:coarse)]:min-h-[44px]">
          <input type="checkbox" className="mt-[3px] h-4 w-4 shrink-0" checked={pico} onChange={(e) => setPico(e.target.checked)} />
          <span>
            Permitir +{Math.round((AGENTE.PESO_MES_EVENTO - 1) * 100)} % del techo en meses de evento
            <span className="block text-[var(--ls-t4)]">El techo del mes se multiplica por {AGENTE.PESO_MES_EVENTO.toLocaleString('es-ES')} en los meses con un evento de temporada.</span>
          </span>
        </label>

        {erroresTemporada.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-[12px]" style={{ color: COLOR_ESTADO.ambar }}>
            {erroresTemporada.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <div className="mt-3">
          <Boton variante="secundario" disabled={erroresTemporada.length > 0} onClick={() => setConfirmar('temporada')}>
            Guardar temporada
          </Boton>
        </div>
      </div>

      <Confirmacion
        abierto={confirmar === 'topes'}
        onCambio={(a) => !a && setConfirmar(null)}
        titulo="¿Guardar los topes?"
        descripcion="Cuentan desde la próxima pasada del agente (cada 5 minutos). La rampa los sigue recortando los 7 primeros días."
        palabra={null}
        tono="normal"
        textoConfirmar="Guardar"
        onConfirmar={guardarTopes}
      />
      <Confirmacion
        abierto={confirmar === 'temporada'}
        onCambio={(a) => !a && setConfirmar(null)}
        titulo="¿Guardar la temporada?"
        descripcion={`${eventos.length} ${eventos.length === 1 ? 'evento manual' : 'eventos manuales'}; techo en meses de evento ${pico ? `× ${AGENTE.PESO_MES_EVENTO.toLocaleString('es-ES')}` : 'sin cambiar'}.`}
        palabra={null}
        tono="normal"
        textoConfirmar="Guardar"
        onConfirmar={guardarTemporada}
      />
    </Tarjeta>
  )
}
