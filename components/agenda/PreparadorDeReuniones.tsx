'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, FileDown, Loader2, Plus, Sparkles, Wand2, X } from 'lucide-react'
import { toast } from 'sonner'
import { BOTON, TEXTO, TITULO } from '@/lib/estilo/denso'
import { guionDeArranque, type CitaDeLaLista, type FichaCliente, type PreparacionGuardada } from '@/lib/agenda/preparar'

/**
 * EL PREPARADOR DE REUNIONES (Agenda → «Preparador de reuniones», 24 nov 2026, Raúl).
 * A la izquierda, las citas de los próximos 14 días; a la derecha, la ficha del cliente (lo que el ERP ya sabe de él) y el guion de la llamada:
 * objetivo, puntos, preguntas y notas. Se guarda solo (1,5 s después de escribir) y sale en un PDF de UNA hoja con la marca para imprimirlo.
 * Si no hay nada preparado, arranca con un guion sin IA hecho con la ficha; «Proponer con IA» lo rehace con la IA barata del ERP.
 */

const CAJA = {
  base: 'min-w-0 overflow-hidden rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]',
  cabecera: 'flex min-h-[42px] items-center gap-2 border-b border-[var(--ls-linea)] px-4 py-2',
  cuerpo: 'px-4 py-3',
} as const
const INPUT =
  'w-full rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2 text-[13px] leading-[1.5] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)]'

interface Guion {
  objetivo: string
  puntos: string[]
  preguntas: string[]
  notas: string
}

const zona = 'Europe/Madrid'
const diaClave = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
const hora = (iso: string) => new Intl.DateTimeFormat('es-ES', { timeZone: zona, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
function nombreDelDia(clave: string): string {
  const hoy = diaClave(new Date().toISOString())
  const manana = diaClave(new Date(Date.now() + 86_400_000).toISOString())
  if (clave === hoy) return 'Hoy'
  if (clave === manana) return 'Mañana'
  const d = new Date(`${clave}T12:00:00Z`)
  const t = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d)
  return t.charAt(0).toUpperCase() + t.slice(1)
}
const VENDE: Record<string, string> = { si: 'Vende en Amazon', no: 'No vende en Amazon', sin_comprobar: 'Amazon sin comprobar' }

export function PreparadorDeReuniones({ inicial }: { inicial: string | null }) {
  const [citas, setCitas] = useState<CitaDeLaLista[] | null>(null)
  const [elegida, setElegida] = useState<string | null>(inicial)
  const [ficha, setFicha] = useState<FichaCliente | null>(null)
  const [guion, setGuion] = useState<Guion | null>(null)
  const [cargando, setCargando] = useState(false)
  const [estado, setEstado] = useState<'guardado' | 'pendiente' | 'guardando' | 'error' | null>(null)
  const [ia, setIa] = useState(false)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ultimoGuardado = useRef<string>('')

  useEffect(() => {
    fetch('/api/agenda/preparar', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { citas?: CitaDeLaLista[]; error?: string }) => {
        if (d.error) toast.error(d.error)
        setCitas(d.citas ?? [])
        if (!inicial && d.citas?.length) setElegida(d.citas[0].id)
      })
      .catch(() => setCitas([]))
  }, [inicial])

  // Al elegir una cita: su ficha y lo preparado (o un primer guion sin IA)
  useEffect(() => {
    if (!elegida) return
    let vivo = true
    setCargando(true)
    setFicha(null)
    setGuion(null)
    setEstado(null)
    fetch(`/api/agenda/preparar/${elegida}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { ficha?: FichaCliente; preparacion?: PreparacionGuardada | null; error?: string }) => {
        if (!vivo) return
        if (d.error || !d.ficha) {
          toast.error(d.error ?? 'No se ha podido leer la ficha')
          return
        }
        setFicha(d.ficha)
        const g = d.preparacion ? { objetivo: d.preparacion.objetivo, puntos: d.preparacion.puntos, preguntas: d.preparacion.preguntas, notas: d.preparacion.notas } : { ...guionDeArranque(d.ficha), notas: '' }
        ultimoGuardado.current = d.preparacion ? JSON.stringify(g) : ''
        setGuion(g)
        setEstado(d.preparacion ? 'guardado' : null)
      })
      .catch(() => toast.error('No se ha podido leer la ficha'))
      .finally(() => vivo && setCargando(false))
    return () => {
      vivo = false
    }
  }, [elegida])

  const guardar = useCallback(
    async (g: Guion): Promise<boolean> => {
      if (!elegida) return false
      const texto = JSON.stringify(g)
      if (texto === ultimoGuardado.current) return true
      setEstado('guardando')
      try {
        const r = await fetch(`/api/agenda/preparar/${elegida}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: texto })
        const d = (await r.json().catch(() => ({}))) as { error?: string }
        if (!r.ok) throw new Error(d.error ?? 'No se ha podido guardar')
        ultimoGuardado.current = texto
        setEstado('guardado')
        setCitas((cs) => cs?.map((c) => (c.id === elegida ? { ...c, preparada: true } : c)) ?? cs)
        return true
      } catch (e) {
        setEstado('error')
        toast.error(e instanceof Error ? e.message : 'No se ha podido guardar')
        return false
      }
    },
    [elegida],
  )

  // Se guarda solo, 1,5 s después del último cambio
  const cambiar = (g: Guion) => {
    setGuion(g)
    setEstado('pendiente')
    if (temporizador.current) clearTimeout(temporizador.current)
    temporizador.current = setTimeout(() => void guardar(g), 1500)
  }
  useEffect(() => () => {
    if (temporizador.current) clearTimeout(temporizador.current)
  }, [])

  const pdf = async () => {
    if (!guion || !elegida) return
    if (temporizador.current) clearTimeout(temporizador.current)
    // Se abre la pestaña ya (los navegadores bloquean las ventanas que no salen directamente del clic) y se le pone el PDF al guardar
    const ventana = window.open('', '_blank')
    const ok = await guardar(guion)
    if (!ok) {
      ventana?.close()
      return
    }
    const url = `/api/agenda/preparar/${elegida}/pdf?v=${Date.now()}`
    if (ventana) ventana.location.href = url
    else window.location.href = url
  }

  const conIa = async () => {
    if (!elegida || !guion) return
    setIa(true)
    try {
      const r = await fetch(`/api/agenda/preparar/${elegida}/ia`, { method: 'POST' })
      const d = (await r.json()) as { objetivo?: string; puntos?: string[]; preguntas?: string[]; error?: string }
      if (!r.ok || d.error) throw new Error(d.error ?? 'No se ha podido')
      cambiar({ ...guion, objetivo: d.objetivo || guion.objetivo, puntos: d.puntos?.length ? d.puntos : guion.puntos, preguntas: d.preguntas?.length ? d.preguntas : guion.preguntas })
      toast.success('Guion propuesto por la IA: revísalo y cambia lo que quieras')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido preparar con la IA')
    } finally {
      setIa(false)
    }
  }

  const porDia = useMemo(() => {
    const m = new Map<string, CitaDeLaLista[]>()
    for (const c of citas ?? []) {
      const k = diaClave(c.inicio)
      m.set(k, [...(m.get(k) ?? []), c])
    }
    return [...m.entries()]
  }, [citas])

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/dashboard/agenda" className={`${BOTON.base} ${BOTON.secundario} ${BOTON.alto}`}>
          <ArrowLeft className="h-3.5 w-3.5" /> Agenda
        </Link>
        <h1 className={TITULO.pantalla}>Preparador de reuniones</h1>
        <span className={`text-[12px] ${TEXTO.t3}`}>Elige una cita, prepara el guion y sácalo en una hoja para tenerlo delante</span>
      </div>

      <div className="grid min-h-0 gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* ---------- las citas ---------- */}
        <aside className={`${CAJA.base} self-start`}>
          <div className={CAJA.cabecera}>
            <h2 className="text-[13px] font-semibold text-[var(--ls-t1)]">Próximas citas</h2>
            <span className={`ml-auto text-[11.5px] ${TEXTO.t4}`}>14 días</span>
          </div>
          <div className="max-h-[70vh] overflow-y-auto py-1">
            {citas === null && <p className={`px-4 py-3 text-[12.5px] ${TEXTO.t3}`}>Cargando…</p>}
            {citas?.length === 0 && <p className={`px-4 py-3 text-[12.5px] ${TEXTO.t3}`}>No tienes citas en los próximos 14 días.</p>}
            {porDia.map(([dia, cs]) => (
              <div key={dia}>
                <p className={`px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide ${TEXTO.t4}`}>{nombreDelDia(dia)}</p>
                {cs.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setElegida(c.id)}
                    aria-current={c.id === elegida || undefined}
                    className={`flex w-full items-start gap-2 px-4 py-2 text-left transition-colors ${c.id === elegida ? 'bg-[var(--ls-sel)]' : 'hover:bg-[var(--ls-sup2)]'}`}
                  >
                    <span className="mt-[1px] w-[38px] shrink-0 text-[12px] font-semibold tabular-nums text-[var(--ls-t2)]">{hora(c.inicio)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-[var(--ls-t1)]">{c.nombre}</span>
                      <span className={`block truncate text-[11.5px] ${TEXTO.t4}`}>{[c.comercial, c.vendeEnAmazon ? VENDE[c.vendeEnAmazon] : null].filter(Boolean).join(' · ')}</span>
                    </span>
                    {c.preparada && <CheckCircle2 className="mt-[2px] h-3.5 w-3.5 shrink-0 text-[var(--ls-e-verde,#22c55e)]" aria-label="Preparada" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </aside>

        {/* ---------- la cita elegida ---------- */}
        <section className="min-w-0 space-y-3">
          {cargando && (
            <div className={`${CAJA.base} ${CAJA.cuerpo} flex items-center gap-2 text-[12.5px] ${TEXTO.t3}`}>
              <Loader2 className="h-4 w-4 animate-spin" /> Juntando lo que sabemos del cliente…
            </div>
          )}
          {ficha && guion && (
            <>
              <div className={`${CAJA.base}`}>
                <div className="flex flex-wrap items-center gap-2 bg-[#0E0E0E] px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[17px] font-semibold text-white">{ficha.nombre}</p>
                    <p className="truncate text-[12px] text-[#EDE6DC]">
                      {[`${nombreDelDia(diaClave(ficha.inicio))} · ${hora(ficha.inicio)}–${hora(ficha.fin)}`, ficha.comercial ? `con ${ficha.comercial}` : null, VENDE[ficha.vendeEnAmazon] ?? null].filter(Boolean).join('  ·  ')}
                    </p>
                  </div>
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <span className="text-[11.5px] text-[#B8AE9F]">
                      {estado === 'guardando' ? 'Guardando…' : estado === 'pendiente' ? 'Sin guardar' : estado === 'guardado' ? 'Guardado' : estado === 'error' ? 'No se ha guardado' : ''}
                    </span>
                    <button type="button" onClick={conIa} disabled={ia} className={`${BOTON.base} ${BOTON.secundario} ${BOTON.alto}`} title="Rehace el objetivo, los puntos y las preguntas con la IA barata del ERP (~0,2 céntimos)">
                      {ia ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {ia ? 'Pensando…' : 'Proponer con IA'}
                    </button>
                    <button type="button" onClick={() => cambiar({ ...guionDeArranque(ficha), notas: guion.notas })} className={`${BOTON.base} ${BOTON.secundario} ${BOTON.alto}`} title="Vuelve al guion de partida hecho con la ficha (sin IA); las notas se quedan">
                      <Wand2 className="h-3.5 w-3.5" /> Guion de partida
                    </button>
                    <button type="button" onClick={pdf} className={`${BOTON.base} ${BOTON.primario} ${BOTON.alto}`}>
                      <FileDown className="h-3.5 w-3.5" /> PDF para imprimir
                    </button>
                  </div>
                </div>
                <FichaVista ficha={ficha} />
              </div>

              <div className={`${CAJA.base}`}>
                <div className={CAJA.cabecera}>
                  <h2 className="text-[13px] font-semibold text-[var(--ls-t1)]">Objetivo de la llamada</h2>
                </div>
                <div className={CAJA.cuerpo}>
                  <textarea value={guion.objetivo} onChange={(e) => cambiar({ ...guion, objetivo: e.target.value })} rows={2} maxLength={600} className={INPUT} placeholder="Qué tienes que conseguir en esta llamada" />
                </div>
              </div>

              <div className="grid gap-3 xl:grid-cols-2">
                <Lista titulo="Puntos a tratar" placeholder="Un punto…" items={guion.puntos} onCambiar={(puntos) => cambiar({ ...guion, puntos })} />
                <Lista titulo="Preguntas" placeholder="Una pregunta…" numerada items={guion.preguntas} onCambiar={(preguntas) => cambiar({ ...guion, preguntas })} />
              </div>

              <div className={`${CAJA.base}`}>
                <div className={CAJA.cabecera}>
                  <h2 className="text-[13px] font-semibold text-[var(--ls-t1)]">Notas</h2>
                  <span className={`ml-auto text-[11.5px] ${TEXTO.t4}`}>Salen en el PDF; debajo queda un recuadro con líneas para apuntar a mano</span>
                </div>
                <div className={CAJA.cuerpo}>
                  <textarea value={guion.notas} onChange={(e) => cambiar({ ...guion, notas: e.target.value })} rows={5} maxLength={4000} className={INPUT} placeholder="Precios que vas a dar, lo que tienes que llevar preparado, lo que no hay que olvidar…" />
                </div>
              </div>
            </>
          )}
          {!cargando && !ficha && citas && citas.length > 0 && <p className={`text-[12.5px] ${TEXTO.t3}`}>Elige una cita de la izquierda.</p>}
        </section>
      </div>
    </div>
  )
}

function FichaVista({ ficha }: { ficha: FichaCliente }) {
  const tipo: Record<string, string> = { llamada: 'Llamada', nota: 'Nota', reunion: 'Reunión', cita: 'Cita' }
  return (
    <div className="grid gap-4 px-4 py-3 lg:grid-cols-2">
      <div className="min-w-0">
        <p className={`mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-acc)]`}>Ficha</p>
        {ficha.datos.length === 0 && <p className={`text-[12.5px] ${TEXTO.t3}`}>La cita no está enlazada a un lead: solo hay lo que se escribió al agendarla.</p>}
        <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-[3px] text-[12.5px]">
          {ficha.datos.map((d) => (
            <div key={d.etiqueta} className="contents">
              <dt className={TEXTO.t4}>{d.etiqueta}</dt>
              <dd className="truncate font-medium text-[var(--ls-t1)]" title={d.valor}>{d.valor}</dd>
            </div>
          ))}
        </dl>
        {ficha.notasDeLaCita && <p className={`mt-2 text-[12px] ${TEXTO.t3}`}>Notas de la cita: {ficha.notasDeLaCita}</p>}
      </div>
      <div className="min-w-0 space-y-3">
        {ficha.amazon && (
          <div>
            <p className={`mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-acc)]`}>Su cuenta de Amazon</p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {ficha.amazon.cifras.map((c) => (
                <span key={c.etiqueta} className="rounded-[8px] border-l-2 border-[var(--ls-acc)] bg-[var(--ls-sup2)] px-2 py-1 text-[11.5px]">
                  <span className={TEXTO.t4}>{c.etiqueta} </span>
                  <b className="text-[var(--ls-t1)]">{c.valor}</b>
                </span>
              ))}
            </div>
            {ficha.amazon.resumen && <p className="text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">{ficha.amazon.resumen}</p>}
            {ficha.amazon.oportunidades.length > 0 && (
              <ul className="mt-1 list-disc pl-4 text-[12px] text-[var(--ls-t2)]">
                {ficha.amazon.oportunidades.map((o) => <li key={o}>{o}</li>)}
              </ul>
            )}
          </div>
        )}
        <div>
          <p className={`mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-acc)]`}>Lo último con el cliente</p>
          {ficha.historial.length === 0 ? (
            <p className={`text-[12.5px] ${TEXTO.t3}`}>No hay llamadas transcritas, notas ni reuniones anteriores.</p>
          ) : (
            <ul className="space-y-1.5">
              {ficha.historial.slice(0, 5).map((h, i) => (
                <li key={i} className="text-[12px] leading-[1.45]">
                  <span className={`mr-1 font-semibold ${TEXTO.t3}`}>{h.fecha.slice(8, 10)}/{h.fecha.slice(5, 7)} · {tipo[h.tipo] ?? h.tipo}</span>
                  <span className="text-[var(--ls-t2)]">{h.texto}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function Lista({ titulo, items, onCambiar, placeholder, numerada }: { titulo: string; items: string[]; onCambiar: (v: string[]) => void; placeholder: string; numerada?: boolean }) {
  const mover = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= items.length) return
    const v = [...items]
    ;[v[i], v[j]] = [v[j], v[i]]
    onCambiar(v)
  }
  return (
    <div className={`${CAJA.base}`}>
      <div className={CAJA.cabecera}>
        <h2 className="text-[13px] font-semibold text-[var(--ls-t1)]">{titulo}</h2>
        <span className={`ml-auto text-[11.5px] ${TEXTO.t4}`}>{items.length}/12</span>
      </div>
      <div className={`${CAJA.cuerpo} space-y-1.5`}>
        {items.map((t, i) => (
          <div key={i} className="group flex items-start gap-1.5">
            <span className={`mt-[7px] w-4 shrink-0 text-right text-[11.5px] font-semibold tabular-nums ${numerada ? 'text-[var(--ls-acc)]' : TEXTO.t4}`}>{numerada ? i + 1 : '•'}</span>
            <textarea
              value={t}
              rows={Math.max(1, Math.ceil(t.length / 70))}
              maxLength={300}
              onChange={(e) => onCambiar(items.map((x, k) => (k === i ? e.target.value : x)))}
              className={`${INPUT} min-h-[34px] resize-none !py-[6px]`}
              placeholder={placeholder}
            />
            <div className="flex shrink-0 flex-col opacity-60 group-hover:opacity-100">
              <button type="button" onClick={() => mover(i, -1)} className="p-[2px] text-[var(--ls-t3)] hover:text-[var(--ls-t1)]" aria-label="Subir"><ArrowUp className="h-3 w-3" /></button>
              <button type="button" onClick={() => mover(i, 1)} className="p-[2px] text-[var(--ls-t3)] hover:text-[var(--ls-t1)]" aria-label="Bajar"><ArrowDown className="h-3 w-3" /></button>
            </div>
            <button type="button" onClick={() => onCambiar(items.filter((_, k) => k !== i))} className="mt-[6px] shrink-0 p-[2px] text-[var(--ls-t4)] hover:text-[var(--ls-e-rojo)]" aria-label="Quitar"><X className="h-3.5 w-3.5" /></button>
          </div>
        ))}
        {items.length < 12 && (
          <button type="button" onClick={() => onCambiar([...items, ''])} className={`${BOTON.base} ${BOTON.secundario} mt-1`}>
            <Plus className="h-3.5 w-3.5" /> Añadir
          </button>
        )}
      </div>
    </div>
  )
}
