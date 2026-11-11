'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, ChevronRight, Copy, Inbox, Loader2, Mail, MailOpen, Paperclip, Plus, Settings2, ShieldCheck, Trash2, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ESTADOS_DE_CASO, normalizarIdDeCaso, type CasoTC, type EstadoDeCaso } from '@/lib/tareas-clientes/casos'
import { nombreDelRemitente } from '@/lib/tareas-clientes/correo-esencial'
import type { PersonaTC } from '@/lib/tareas-clientes/tipos'
import { Avatar } from './AvatarTC'
import { BASE, pedir } from './api'

/**
 * LA PESTAÑA «CUMPLIMIENTO» DE UN CLIENTE: SUS CASOS CON AYUDA AL VENDEDOR.
 *
 * Arriba, dar de alta un caso: el ID del caso de Amazon es obligatorio (se escribe a mano, como sale en Seller Central) porque es lo que une el
 * caso con los correos de Amazon que llegan al buzón vigilado. Debajo, cada caso como una fila que se despliega: estado, responsable, notas
 * y los correos, cada uno con su vista previa también desplegable.
 */

const TONO: Record<'azul' | 'ambar' | 'violeta' | 'verde', string> = { azul: 'var(--tc-blue)', ambar: 'var(--tc-yellow)', violeta: 'var(--tc-purple)', verde: 'var(--tc-green)' }
const tonoDe = (e: EstadoDeCaso) => TONO[ESTADOS_DE_CASO.find((x) => x.id === e)?.tono ?? 'azul']
const nombreDe = (e: EstadoDeCaso) => ESTADOS_DE_CASO.find((x) => x.id === e)?.nombre ?? e

function haceCuanto(iso: string | null): string {
  if (!iso) return ''
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'ayer' : `hace ${d} días`
}
const fecha = (iso: string) => new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const CAMPO = 'h-8 w-full rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2.5 text-[12.5px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc)]'

interface Datos {
  casos: CasoTC[]
  vigilados: string[]
  hayCanal: boolean
}

export function Casos({ clienteId, personas, miId, esAdmin, casoInicial, onAbiertos }: { clienteId: string; personas: readonly PersonaTC[]; miId: string; esAdmin: boolean; casoInicial?: string | null; onAbiertos?: (n: number) => void }) {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set(casoInicial ? [casoInicial] : []))
  const [verResueltos, setVerResueltos] = useState(false)
  const [nuevo, setNuevo] = useState(false)

  const cargar = useCallback(async () => {
    try {
      setDatos(await pedir<Datos>(`${BASE}/casos?clienteId=${clienteId}`))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se han podido leer los casos')
    }
  }, [clienteId])

  useEffect(() => {
    void cargar()
    // Los correos de Amazon llegan solos: se relee cada minuto mientras la pestaña está a la vista
    const t = setInterval(() => document.visibilityState === 'visible' && void cargar(), 60_000)
    return () => clearInterval(t)
  }, [cargar])

  // El contador de la pestaña y de la tarjeta del cliente sigue a lo que se ve aquí
  useEffect(() => {
    if (datos) onAbiertos?.(datos.casos.filter((c) => c.estado !== 'resuelto').length)
  }, [datos, onAbiertos])

  useEffect(() => {
    if (!casoInicial || !datos) return
    document.getElementById(`caso-${casoInicial}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [casoInicial, datos])

  async function cambiar(id: string, cambios: Partial<Pick<CasoTC, 'estado' | 'responsable' | 'notas' | 'titulo'>>) {
    setDatos((d) => (d ? { ...d, casos: d.casos.map((c) => (c.id === id ? { ...c, ...cambios, actualizadoEn: new Date().toISOString() } : c)) } : d))
    try {
      await pedir(`${BASE}/casos`, { metodo: 'PATCH', cuerpo: { id, ...cambios } })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido guardar')
      void cargar()
    }
  }

  async function borrar(c: CasoTC) {
    if (!window.confirm(`¿Borrar el caso ${c.casoAmazon} del ERP? Los correos siguen en el buzón; en Amazon no cambia nada.`)) return
    try {
      await pedir(`${BASE}/casos`, { metodo: 'DELETE', cuerpo: { id: c.id } })
      setDatos((d) => (d ? { ...d, casos: d.casos.filter((x) => x.id !== c.id) } : d))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido borrar')
    }
  }

  if (error) {
    return (
      <div className="mx-auto mt-6 flex max-w-[640px] items-start gap-2 rounded-[12px] border border-[var(--ls-linea)] bg-[var(--tc-cristal)] p-4 text-[13px] text-[var(--ls-t2)]">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--tc-yellow)]" /> {error}
      </div>
    )
  }
  if (!datos) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-[12.5px] text-[var(--ls-t3)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Leyendo los casos…
      </div>
    )
  }

  const vivos = datos.casos.filter((c) => c.estado !== 'resuelto')
  const resueltos = datos.casos.filter((c) => c.estado === 'resuelto')
  const alternar = (id: string) => setAbiertos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-3 pb-10">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-[var(--ls-t1)]">
          <ShieldCheck className="h-4 w-4 text-[var(--ls-acc)]" /> Casos de cumplimiento normativo
          <span className="rounded-full bg-[var(--ls-sup3)] px-2 py-px text-[11px] font-medium tabular-nums text-[var(--ls-t3)]">{vivos.length} {vivos.length === 1 ? 'abierto' : 'abiertos'}</span>
        </span>
        <span className="flex-1" />
        <EstadoDelBuzon vigilados={datos.vigilados} hayCanal={datos.hayCanal} esAdmin={esAdmin} onCambio={() => void cargar()} />
        <button type="button" onClick={() => setNuevo((v) => !v)} className="tc-boton-primario"><Plus className="h-3.5 w-3.5" /> Nuevo caso</button>
      </div>

      {nuevo && (
        <NuevoCaso
          clienteId={clienteId}
          personas={personas}
          miId={miId}
          onCerrar={() => setNuevo(false)}
          onCreado={(c) => {
            setNuevo(false)
            setDatos((d) => (d ? { ...d, casos: [c, ...d.casos] } : d))
            setAbiertos((s) => new Set(s).add(c.id))
            toast.success(c.correos.length > 0 ? `Caso dado de alta con ${c.correos.length} ${c.correos.length === 1 ? 'correo que ya había llegado' : 'correos que ya habían llegado'}` : 'Caso dado de alta. Sus correos aparecerán aquí al llegar.')
          }}
        />
      )}

      {datos.casos.length === 0 && !nuevo && (
        <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed border-[var(--ls-linea2)] bg-[var(--tc-cristal)] px-6 py-12 text-center">
          <ShieldCheck className="h-6 w-6 text-[var(--ls-t4)]" />
          <p className="text-[13px] font-medium text-[var(--ls-t1)]">Este cliente no tiene casos de cumplimiento</p>
          <p className="max-w-[460px] text-[12px] text-[var(--ls-t3)]">Cuando abras un caso con Ayuda al vendedor, dalo de alta aquí con su ID. Los correos de Amazon de ese caso se colgarán solos y avisarán en #cumplimiento-normativo.</p>
          <button type="button" onClick={() => setNuevo(true)} className="tc-boton-primario mt-1"><Plus className="h-3.5 w-3.5" /> Nuevo caso</button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {vivos.map((c, i) => (
          <FilaDeCaso key={c.id} caso={c} indice={i} personas={personas} abierto={abiertos.has(c.id)} resaltado={c.id === casoInicial} onAlternar={() => alternar(c.id)} onCambiar={(x) => void cambiar(c.id, x)} onBorrar={() => void borrar(c)} />
        ))}
      </div>

      {resueltos.length > 0 && (
        <div className="flex flex-col gap-2">
          <button type="button" onClick={() => setVerResueltos((v) => !v)} className="flex items-center gap-1.5 self-start rounded-[6px] px-1 py-1 text-[12px] font-medium text-[var(--ls-t3)] hover:text-[var(--ls-t1)]">
            <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-200 ${verResueltos ? 'rotate-90' : ''}`} /> Resueltos <span className="tabular-nums text-[var(--ls-t4)]">{resueltos.length}</span>
          </button>
          {verResueltos && resueltos.map((c, i) => (
            <FilaDeCaso key={c.id} caso={c} indice={i} personas={personas} abierto={abiertos.has(c.id)} resaltado={c.id === casoInicial} onAlternar={() => alternar(c.id)} onCambiar={(x) => void cambiar(c.id, x)} onBorrar={() => void borrar(c)} />
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function EstadoDelBuzon({ vigilados, hayCanal, esAdmin, onCambio }: { vigilados: string[]; hayCanal: boolean; esAdmin: boolean; onCambio: () => void }) {
  const [ajustes, setAjustes] = useState<{ buzones: Array<{ id: string; direccion: string; nombre: string | null; vigilado: boolean }>; elegidos: string[] } | null>(null)
  const sinBuzon = vigilados.length === 0
  const texto = sinBuzon ? 'Ningún buzón conectado' : vigilados.length === 1 ? vigilados[0] : `${vigilados.length} buzones`

  async function abrir(open: boolean) {
    if (open && esAdmin && !ajustes) {
      try {
        setAjustes(await pedir(`${BASE}/casos?ajustes=1`))
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'No se han podido leer los buzones')
      }
    }
  }

  async function guardar(ids: string[]) {
    try {
      await pedir(`${BASE}/casos`, { metodo: 'PUT', cuerpo: { buzones: ids } })
      setAjustes(await pedir(`${BASE}/casos?ajustes=1`))
      onCambio()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido guardar')
    }
  }

  return (
    <Popover onOpenChange={(o) => void abrir(o)}>
      <PopoverTrigger asChild>
        <button type="button" className="tc-boton-herramienta" title="De dónde salen los correos de los casos">
          {sinBuzon ? <AlertTriangle className="h-3.5 w-3.5 text-[var(--tc-yellow)]" /> : <Inbox className="h-3.5 w-3.5" />} {texto}
          {!hayCanal && <span className="text-[var(--tc-yellow)]"> · sin canal</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="!w-[340px] !rounded-[12px] !border-[var(--ls-linea2)] !bg-[var(--ls-sup)] !p-3 !text-[var(--ls-t1)] shadow-[0_18px_50px_rgba(0,0,0,0.4)]">
        <div className="flex flex-col gap-2 text-[12.5px]">
          <p className="text-[12px] leading-relaxed text-[var(--ls-t3)]">
            Los correos que nombran el ID de un caso se buscan en {sinBuzon ? 'el buzón business@ en cuanto se conecte en la app Correo' : <b className="text-[var(--ls-t1)]">{vigilados.join(', ')}</b>}.
            {hayCanal ? ' Cada uno avisa en #cumplimiento-normativo.' : ' No existe el canal #cumplimiento-normativo: créalo en el chat para que avise.'}
          </p>
          {esAdmin && (
            <div className="border-t border-[var(--ls-linea)] pt-2">
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ls-t4)]"><Settings2 className="h-3 w-3" /> Buzones que se vigilan</p>
              {!ajustes ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ls-t4)]" />
              ) : (
                <div className="flex max-h-[220px] flex-col gap-px overflow-auto">
                  {ajustes.buzones.map((b) => (
                    <label key={b.id} className="tc-opcion cursor-pointer">
                      <input
                        type="checkbox"
                        className="tc-casilla"
                        checked={ajustes.elegidos.length > 0 ? ajustes.elegidos.includes(b.id) : b.vigilado}
                        onChange={(e) => {
                          const base = ajustes.elegidos.length > 0 ? ajustes.elegidos : ajustes.buzones.filter((x) => x.vigilado).map((x) => x.id)
                          void guardar(e.target.checked ? [...base, b.id] : base.filter((x) => x !== b.id))
                        }}
                      />
                      <span className="min-w-0 truncate">{b.direccion}</span>
                    </label>
                  ))}
                  {ajustes.elegidos.length === 0 && <p className="px-2 pt-1 text-[11px] text-[var(--ls-t4)]">Sin elegir ninguno se vigila el que empieza por business@.</p>}
                </div>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/* ------------------------------------------------------------------ */

function NuevoCaso({ clienteId, personas, miId, onCerrar, onCreado }: { clienteId: string; personas: readonly PersonaTC[]; miId: string; onCerrar: () => void; onCreado: (c: CasoTC) => void }) {
  const [id, setId] = useState('')
  const [titulo, setTitulo] = useState('')
  const [responsable, setResponsable] = useState(personas.some((p) => p.id === miId) ? miId : '')
  const [estado, setEstado] = useState<EstadoDeCaso>('esperando_amazon')
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const idValido = normalizarIdDeCaso(id)
  const primero = useRef<HTMLInputElement>(null)
  useEffect(() => primero.current?.focus(), [])

  async function crear() {
    if (!idValido || !titulo.trim()) return
    setGuardando(true)
    try {
      const r = await pedir<{ caso: CasoTC }>(`${BASE}/casos`, { metodo: 'POST', cuerpo: { clienteId, casoAmazon: idValido, titulo, responsable: responsable || null, estado, notas } })
      onCreado(r.caso)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido dar de alta')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); void crear() }}
      className="tc-casos-entra grid gap-3 rounded-[14px] border border-[var(--ls-linea2)] bg-[var(--tc-cristal)] p-4 shadow-[var(--tc-sombra-2)] md:grid-cols-[220px_1fr]"
    >
      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] font-semibold text-[var(--ls-t2)]">ID del caso de Amazon <span className="text-[var(--tc-red)]">*</span></span>
        <input ref={primero} value={id} onChange={(e) => setId(e.target.value)} inputMode="numeric" placeholder="17123456781" className={`${CAMPO} font-mono tabular-nums`} aria-invalid={id !== '' && !idValido} />
        <span className={`text-[11px] ${id !== '' && !idValido ? 'text-[var(--tc-red)]' : 'text-[var(--ls-t4)]'}`}>{id !== '' && !idValido ? 'Solo números, como sale en Ayuda al vendedor.' : 'Cópialo de Seller Central → Registro de casos.'}</span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] font-semibold text-[var(--ls-t2)]">De qué va <span className="text-[var(--tc-red)]">*</span></span>
        <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="GPSR de The Voting Game: documento rechazado" className={CAMPO} maxLength={300} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] font-semibold text-[var(--ls-t2)]">Estado</span>
        <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoDeCaso)} className={CAMPO}>
          {ESTADOS_DE_CASO.filter((x) => x.id !== 'resuelto').map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] font-semibold text-[var(--ls-t2)]">Responsable</span>
        <select value={responsable} onChange={(e) => setResponsable(e.target.value)} className={CAMPO}>
          <option value="">Sin responsable</option>
          {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 md:col-span-2">
        <span className="text-[11.5px] font-semibold text-[var(--ls-t2)]">Notas</span>
        <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} placeholder="Qué se ha pedido a Amazon, qué falta…" className={`${CAMPO} h-auto py-1.5`} maxLength={5000} />
      </label>
      <div className="flex items-center justify-end gap-2 md:col-span-2">
        <button type="button" onClick={onCerrar} className="tc-boton-herramienta">Cancelar</button>
        <button type="submit" disabled={!idValido || !titulo.trim() || guardando} className="tc-boton-primario disabled:opacity-50">
          {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} Dar de alta el caso
        </button>
      </div>
    </form>
  )
}

/* ------------------------------------------------------------------ */

function FilaDeCaso({ caso, indice, personas, abierto, resaltado, onAlternar, onCambiar, onBorrar }: {
  caso: CasoTC
  indice: number
  personas: readonly PersonaTC[]
  abierto: boolean
  resaltado: boolean
  onAlternar: () => void
  onCambiar: (c: Partial<Pick<CasoTC, 'estado' | 'responsable' | 'notas' | 'titulo'>>) => void
  onBorrar: () => void
}) {
  const [notas, setNotas] = useState<string | null>(null)
  const responsable = personas.find((p) => p.id === caso.responsable) ?? null
  const ultimo = caso.correos[0] ?? null
  const tono = tonoDe(caso.estado)

  return (
    <article
      id={`caso-${caso.id}`}
      className={`tc-casos-entra overflow-hidden rounded-[14px] border bg-[var(--tc-tarjeta)] shadow-[var(--tc-sombra-1)] transition-[border-color,box-shadow] duration-150 ${abierto ? 'border-[var(--ls-linea2)] shadow-[var(--tc-sombra-2)]' : 'border-[var(--ls-linea)] hover:border-[var(--ls-linea2)]'} ${resaltado ? 'ring-1 ring-[var(--ls-acc)]' : ''}`}
      style={{ '--i': Math.min(indice, 8), borderLeft: `3px solid ${tono}` } as CSSProperties}
    >
      <div className="flex items-center gap-3 px-3.5 py-2.5">
        <button type="button" onClick={onAlternar} aria-expanded={abierto} aria-label={abierto ? 'Plegar el caso' : 'Desplegar el caso'} className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--ls-t3)] transition-[transform,background-color] duration-200 hover:bg-[var(--ls-sup3)] ${abierto ? 'rotate-90 bg-[var(--ls-sup3)] text-[var(--ls-t1)]' : ''}`}>
          <ChevronRight className="h-4 w-4" />
        </button>
        <button type="button" onClick={onAlternar} className="flex min-w-0 flex-1 flex-col text-left">
          <span className="truncate text-[13.5px] font-semibold text-[var(--ls-t1)]">{caso.titulo}</span>
          <span className="flex min-w-0 items-center gap-2 text-[11.5px] text-[var(--ls-t4)]">
            <span className="font-mono text-[var(--ls-t3)]">#{caso.casoAmazon}</span>
            {ultimo ? <span className="truncate">· {ultimo.de}: {ultimo.asunto} · {haceCuanto(ultimo.fecha)}</span> : <span>· sin correos todavía</span>}
          </span>
        </button>
        <span className="hidden items-center gap-1 text-[11.5px] text-[var(--ls-t3)] sm:flex" title={`${caso.correos.length} correos`}>
          <Mail className="h-3.5 w-3.5" /> <span className="tabular-nums">{caso.correos.length}</span>
        </span>
        <SelectorDeEstado estado={caso.estado} onElegir={(estado) => onCambiar({ estado })} />
        <span className="hidden w-[24px] shrink-0 md:block" title={responsable?.nombre ?? 'Sin responsable'}>{responsable ? <Avatar id={responsable.id} nombre={responsable.nombre} tamano={22} /> : null}</span>
      </div>

      {abierto && (
        <div className="tc-casos-despliega grid gap-4 border-t border-[var(--ls-linea)] bg-[color-mix(in_srgb,var(--tc-base)_35%,var(--tc-tarjeta))] px-4 py-3.5 lg:grid-cols-[260px_1fr]">
          <div className="flex flex-col gap-3 text-[12.5px]">
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ls-t4)]">ID del caso</p>
              <button type="button" onClick={() => void navigator.clipboard?.writeText(caso.casoAmazon).then(() => toast.success('ID copiado'))} className="inline-flex items-center gap-1.5 rounded-[6px] bg-[var(--ls-sup3)] px-2 py-1 font-mono text-[12.5px] text-[var(--ls-t1)] hover:bg-[var(--ls-sup2)]" title="Copiar para buscarlo en Seller Central">
                {caso.casoAmazon} <Copy className="h-3 w-3 text-[var(--ls-t4)]" />
              </button>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ls-t4)]">Responsable</span>
              <select value={caso.responsable ?? ''} onChange={(e) => onCambiar({ responsable: e.target.value || null })} className={CAMPO}>
                <option value="">Sin responsable</option>
                {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ls-t4)]">Notas</span>
              <textarea
                value={notas ?? caso.notas}
                onChange={(e) => setNotas(e.target.value)}
                onBlur={() => { if (notas !== null && notas !== caso.notas) onCambiar({ notas }); setNotas(null) }}
                rows={4}
                placeholder="Qué se ha pedido, qué falta, próximos pasos…"
                className={`${CAMPO} h-auto resize-y py-1.5`}
              />
            </label>
            <p className="text-[11px] text-[var(--ls-t4)]">Alta {haceCuanto(caso.creadoEn)} · cambiado {haceCuanto(caso.actualizadoEn)}</p>
            <button type="button" onClick={onBorrar} className="inline-flex items-center gap-1.5 self-start text-[11.5px] text-[var(--ls-t4)] hover:text-[var(--tc-red)]"><Trash2 className="h-3 w-3" /> Borrar el caso</button>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ls-t4)]">Correos de Amazon <span className="tabular-nums">· {caso.correos.length}</span></p>
            {caso.correos.length === 0 ? (
              <p className="rounded-[10px] border border-dashed border-[var(--ls-linea2)] px-3 py-4 text-[12px] text-[var(--ls-t3)]">Todavía no ha llegado ningún correo con el ID {caso.casoAmazon}. En cuanto llegue al buzón vigilado aparecerá aquí y avisará en el canal.</p>
            ) : (
              caso.correos.map((m, i) => <CorreoDesplegable key={m.id} casoId={caso.id} correo={m} inicialAbierto={i === 0 && caso.correos.length === 1} />)
            )}
          </div>
        </div>
      )}
    </article>
  )
}

function SelectorDeEstado({ estado, onElegir }: { estado: EstadoDeCaso; onElegir: (e: EstadoDeCaso) => void }) {
  const [abierto, setAbierto] = useState(false)
  const tono = tonoDe(estado)
  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex h-[24px] shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-semibold" style={{ color: tono, background: `color-mix(in srgb, ${tono} 14%, transparent)` }}>
          <span className="h-[6px] w-[6px] rounded-full" style={{ background: tono }} /> {nombreDe(estado)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="!w-[210px] !rounded-[10px] !border-[var(--ls-linea2)] !bg-[var(--ls-sup)] !p-1.5 !text-[var(--ls-t1)] shadow-[0_14px_40px_rgba(0,0,0,0.35)]">
        {ESTADOS_DE_CASO.map((x) => (
          <button key={x.id} type="button" className="tc-opcion w-full" onClick={() => { setAbierto(false); if (x.id !== estado) onElegir(x.id) }}>
            <span className="h-[7px] w-[7px] rounded-full" style={{ background: TONO[x.tono] }} /> {x.nombre}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

/* ------------------------------------------------------------------ */

type CorreoEntero = { de: string; deOriginal: string | null; para: string[]; asunto: string; fecha: string; html: string | null; texto: string; adjuntos: string[]; parrafos: string[] }

/** Los ASIN y los números de caso, resaltados (y se copian con un clic) dentro del texto del correo */
const MARCAS = /\b(B0[A-Z0-9]{8}|\d{10,14})\b/g

function TextoConMarcas({ texto }: { texto: string }) {
  const trozos: Array<string | { v: string }> = []
  let ultimo = 0
  for (const m of texto.matchAll(MARCAS)) {
    if (m.index! > ultimo) trozos.push(texto.slice(ultimo, m.index))
    trozos.push({ v: m[0] })
    ultimo = m.index! + m[0].length
  }
  if (ultimo < texto.length) trozos.push(texto.slice(ultimo))
  return (
    <>
      {trozos.map((t, i) =>
        typeof t === 'string' ? (
          t
        ) : (
          <button
            key={i}
            type="button"
            onClick={() => void navigator.clipboard?.writeText(t.v).then(() => toast.success(`${t.v} copiado`))}
            title="Copiar"
            className="rounded-[4px] bg-[var(--ls-sup2)] px-1 font-mono text-[12px] text-[var(--ls-t1)] transition-colors hover:bg-[var(--ls-acc-suave,rgba(255,140,40,0.14))] hover:text-[var(--ls-acc)]"
          >
            {t.v}
          </button>
        )
      )}
    </>
  )
}

/** Un correo del caso: una línea con quién, asunto y cuándo; al desplegarlo, SOLO lo que dice (sin el diseño, la cabecera del reenvío, la encuesta ni la firma). El correo tal cual queda a un clic, por si hiciera falta */
function CorreoDesplegable({ casoId, correo, inicialAbierto }: { casoId: string; correo: CasoTC['correos'][number]; inicialAbierto: boolean }) {
  const [abierto, setAbierto] = useState(inicialAbierto)
  const [entero, setEntero] = useState<CorreoEntero | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [alto, setAlto] = useState(320)
  const [original, setOriginal] = useState(false)
  const marco = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!abierto || entero) return
    pedir<{ correo: CorreoEntero }>(`${BASE}/casos?caso=${casoId}&correo=${correo.id}`)
      .then((r) => setEntero(r.correo))
      .catch((e: Error) => setError(e.message))
  }, [abierto, entero, casoId, correo.id])

  const documento = useMemo(() => {
    if (!entero) return ''
    const cuerpo = entero.html ?? `<pre style="white-space:pre-wrap;font:13px/1.55 system-ui,sans-serif;margin:0">${entero.texto.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c)}</pre>`
    return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{margin:0;padding:16px;background:#fff;color:#111;font:13px/1.55 system-ui,sans-serif;word-break:break-word}img{max-width:100%;height:auto}</style></head><body>${cuerpo}</body></html>`
  }, [entero])

  return (
    <div className={`overflow-hidden rounded-[10px] border transition-colors duration-150 ${abierto ? 'border-[var(--ls-linea2)] bg-[var(--ls-sup)]' : 'border-[var(--ls-linea)] bg-[var(--ls-sup2)] hover:border-[var(--ls-linea2)]'}`}>
      <button type="button" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} className="flex w-full items-center gap-2.5 px-3 py-2 text-left">
        {abierto ? <MailOpen className="h-3.5 w-3.5 shrink-0 text-[var(--ls-acc)]" /> : <Mail className="h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)]" />}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[12.5px] font-medium text-[var(--ls-t1)]">{correo.asunto || '(sin asunto)'}</span>
            {correo.adjuntos > 0 && <Paperclip className="h-3 w-3 shrink-0 text-[var(--ls-t4)]" />}
          </span>
          {!abierto && <span className="truncate text-[11.5px] text-[var(--ls-t4)]">{correo.de} — {correo.vistaPrevia}</span>}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-[var(--ls-t4)]" title={new Date(correo.fecha).toLocaleString('es-ES')}>{fecha(correo.fecha)}</span>
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)] transition-transform duration-200 ${abierto ? 'rotate-90' : ''}`} />
      </button>
      {abierto && (
        <div className="tc-casos-despliega border-t border-[var(--ls-linea)]">
          {error ? (
            <p className="flex items-center gap-2 px-3 py-3 text-[12px] text-[var(--ls-t3)]"><X className="h-3.5 w-3.5 text-[var(--tc-red)]" /> {error}</p>
          ) : !entero ? (
            <p className="flex items-center gap-2 px-3 py-4 text-[12px] text-[var(--ls-t3)]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Abriendo el correo…</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 px-4 pt-3 text-[11.5px] text-[var(--ls-t3)]">
                <span title={entero.deOriginal ?? entero.de}><b className="font-medium text-[var(--ls-t2)]">De</b> {nombreDelRemitente(entero.deOriginal ?? entero.de)}</span>
                {entero.deOriginal && <span className="text-[var(--ls-t4)]">reenviado por {nombreDelRemitente(entero.de)}</span>}
                {entero.adjuntos.length > 0 && <span className="inline-flex items-center gap-1"><Paperclip className="h-3 w-3" /> {entero.adjuntos.join(', ')}</span>}
                <span className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard?.writeText(entero.parrafos.join('\n\n')).then(() => toast.success('Texto copiado'))}
                    className="inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[var(--ls-t4)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]"
                  >
                    <Copy className="h-3 w-3" /> Copiar
                  </button>
                  <button
                    type="button"
                    onClick={() => setOriginal((v) => !v)}
                    aria-pressed={original}
                    className="inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[var(--ls-t4)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]"
                  >
                    {original ? 'Ver solo el texto' : 'Ver el original'}
                  </button>
                </span>
              </div>
              {!original ? (
                <div className="tc-casos-despliega space-y-3 px-4 pb-4 pt-2.5 text-[13px] leading-[1.65] text-[var(--ls-t2)]">
                  {entero.parrafos.length === 0 ? (
                    <p className="text-[var(--ls-t4)]">El correo no trae texto.</p>
                  ) : (
                    entero.parrafos.map((p, i) => (
                      <p key={i} className="whitespace-pre-line break-words">
                        <TextoConMarcas texto={p} />
                      </p>
                    ))
                  )}
                </div>
              ) : (
              <iframe
                ref={marco}
                title={entero.asunto || 'Correo'}
                sandbox="allow-same-origin allow-popups"
                srcDoc={documento}
                onLoad={() => {
                  const h = marco.current?.contentDocument?.documentElement?.scrollHeight
                  if (h) setAlto(Math.min(Math.max(h + 4, 140), 640))
                }}
                className="block w-full border-0 bg-white"
                style={{ height: alto }}
              />
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
