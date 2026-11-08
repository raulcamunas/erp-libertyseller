'use client'

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlertTriangle, CheckCircle2, CloudOff, Flame, ImageIcon, LayoutGrid, Loader2, Palette, RefreshCw, ShieldCheck, Star, UserCheck } from 'lucide-react'
import { toast } from 'sonner'
import type { EstadisticasDeCliente } from '@/lib/tareas-clientes/servidor'
import { ETIQUETA_DE_GRUPO, type ClienteTC, type GrupoDeCliente, type Portada as PortadaGuardada } from '@/lib/tareas-clientes/tipos'
import { saludoDe } from '@/lib/inicio/saludo'
import { BASE, pedir, type DatosDeInicio, type Preferencias } from './api'
import { FondoAnimado, SelectorDePortada, estiloDePortada, fondoNecesitaCortina } from './Portada'
import { AccesosDeClientes } from './AccesosDeClientes'
import { PilaDeAvatares } from './ui'

/**
 * LA PÁGINA DE INICIO DE TAREAS DE CLIENTES: una portada (tuya, que se cambia), el resumen de lo que hay por hacer y todos los clientes en tarjetas de tres en tres, en los
 * dos grupos de Notion. Las tarjetas se reordenan arrastrándolas; pulsar una abre el espacio de ese cliente.
 */

const GRUPOS: GrupoDeCliente[] = ['agencia', 'marcas_eeuu', 'otros']
const COLOR_DE_GRUPO: Record<GrupoDeCliente, string> = { agencia: 'orange', marcas_eeuu: 'blue', otros: 'gray' }

interface EstadoDeNotion {
  permitido: boolean
  clave?: boolean
  escritura?: boolean
  integracion?: { nombre?: string; espacio?: string; error?: string } | null
  cola?: { pendientes: number; conFallos: Array<{ id: number; operacion: string; error: string | null }> }
  clientes?: Array<{ id: string; nombre: string; sync_ultima: string | null; sync_error: string | null }>
  webhook?: { tokenRecibido: boolean; token: string | null }
}

export function Inicio({ esAdmin }: { esAdmin: boolean }) {
  const router = useRouter()
  const [datos, setDatos] = useState<DatosDeInicio | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notion, setNotion] = useState<EstadoDeNotion | null>(null)
  const [sincronizando, setSincronizando] = useState(false)
  const [accesosAbierto, setAccesosAbierto] = useState(false)

  const cargar = useCallback(async () => {
    try {
      setDatos(await pedir<DatosDeInicio>(`${BASE}/inicio`))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se han podido leer los clientes')
    }
  }, [])

  const cargarNotion = useCallback(async () => {
    if (!esAdmin) return
    setNotion(await pedir<EstadoDeNotion>(`${BASE}/notion/estado`).catch(() => null))
  }, [esAdmin])

  useEffect(() => {
    void cargar()
    void cargarNotion()
    const t = setInterval(() => document.visibilityState === 'visible' && void cargar(), 60_000)
    return () => clearInterval(t)
  }, [cargar, cargarNotion])

  const prefs: Preferencias = datos?.preferencias ?? { fondo: {}, portada: {}, favoritos: [] }

  const guardarPrefs = async (cambios: Partial<Preferencias>) => {
    setDatos((d) => (d ? { ...d, preferencias: { ...prefs, ...cambios } } : d))
    try {
      await pedir(`${BASE}/preferencias`, { metodo: 'PUT', cuerpo: cambios })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido guardar')
    }
  }

  const totales = useMemo(() => {
    const t = { abiertas: 0, vencidas: 0, hechas: 0 }
    for (const e of Object.values(datos?.estadisticas ?? {})) {
      t.abiertas += e.pendientes + e.enCurso
      t.vencidas += e.vencidas
      t.hechas += e.hechas
    }
    return t
  }, [datos?.estadisticas])

  const sincronizar = async () => {
    setSincronizando(true)
    try {
      const r = await pedir<{ ok: boolean; motivo?: string; creadas: number; actualizadas: number; enviadas: number; clientes: number }>(`${BASE}/notion/sincronizar`, { metodo: 'POST', cuerpo: {} })
      if (r.ok) toast.success(`Notion al día: ${r.creadas} nuevas, ${r.actualizadas} actualizadas, ${r.enviadas} enviadas`)
      else toast.error(r.motivo ?? 'La sincronización no se ha completado')
      await Promise.all([cargar(), cargarNotion()])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido sincronizar')
    } finally {
      setSincronizando(false)
    }
  }

  if (error && !datos) {
    return (
      <div className="tc-inicio flex items-center justify-center" role="alert">
        <div className="flex flex-col items-center gap-3 text-center"><AlertTriangle className="h-6 w-6 text-[var(--ls-e-ambar)]" /><p className="text-[13.5px] text-[var(--ls-t2)]">{error}</p><button type="button" onClick={() => void cargar()} className="tc-boton-primario"><RefreshCw className="h-3.5 w-3.5" /> Reintentar</button></div>
      </div>
    )
  }
  if (!datos) {
    return (
      <div className="tc-inicio" role="status" aria-label="Cargando los clientes">
        <div className="tc-esqueleto h-[150px] rounded-[14px]" />
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="tc-esqueleto h-[150px]" />)}</div>
      </div>
    )
  }

  return (
    <div className="tc-inicio" data-fondo={fondoNecesitaCortina(prefs.fondo) ? 'true' : undefined} style={estiloDePortada(prefs.fondo, true)}>
      <FondoAnimado valor={prefs.fondo} />
      <section className="tc-hero" style={estiloDePortada(prefs.portada)} data-vacia={prefs.portada.tipo ? undefined : 'true'}>
        <div className="tc-hero-velo" />
        <div className="relative z-10 flex flex-wrap items-end gap-x-8 gap-y-4 p-6">
          <div className="min-w-0 flex-1">
            <p className="tc-hero-sobre">{saludoDe(new Date().getHours())} · Liberty Seller</p>
            <h1 className="tc-hero-titulo">Tareas de clientes</h1>
            <p className="tc-hero-texto">Todo lo que hay por hacer en cada cuenta, conectado con Notion: lo que se mueve aquí se mueve allí y al revés.</p>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Resumen">
            <Cifra icono={<LayoutGrid className="h-3.5 w-3.5" />} valor={totales.abiertas} nombre="por hacer" />
            <Cifra icono={<Flame className="h-3.5 w-3.5" />} valor={totales.vencidas} nombre="vencidas" alerta={totales.vencidas > 0} />
            <Cifra icono={<CheckCircle2 className="h-3.5 w-3.5" />} valor={totales.hechas} nombre="hechas" />
          </div>
        </div>
        <div className="tc-cover-botones">
          <SelectorDePortada valor={prefs.portada} titulo="Tu portada" onElegir={(p: PortadaGuardada) => void guardarPrefs({ portada: p })}><button type="button" className="tc-boton-cristal"><ImageIcon className="h-3 w-3" /> Portada</button></SelectorDePortada>
          <SelectorDePortada animados valor={prefs.fondo} titulo="Tu fondo" onElegir={(p: PortadaGuardada) => void guardarPrefs({ fondo: p })}><button type="button" className="tc-boton-cristal"><Palette className="h-3 w-3" /> Fondo</button></SelectorDePortada>
        </div>
      </section>

      <div className={`mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 ${esAdmin ? 'xl:grid-cols-3' : ''}`}>
        <Atajo icono={<LayoutGrid className="h-4 w-4" />} titulo="Todas las tareas" detalle={`${totales.abiertas} por hacer en ${datos.clientes.length} clientes`} onClick={() => router.push('/dashboard/tareas-clientes/todas')} color="blue" />
        <Atajo icono={<UserCheck className="h-4 w-4" />} titulo="Mis tareas" detalle={datos.mias.abiertas === 0 ? 'Nada pendiente' : `${datos.mias.abiertas} por hacer${datos.mias.vencidas > 0 ? ` · ${datos.mias.vencidas} vencidas` : ''}`} onClick={() => router.push('/dashboard/tareas-clientes/mis-tareas')} color="green" alerta={datos.mias.vencidas > 0} />
        {esAdmin && <Atajo icono={<ShieldCheck className="h-4 w-4" />} titulo="Quién ve qué" detalle="Limitar a cada persona a unos clientes" onClick={() => setAccesosAbierto(true)} color="purple" />}
      </div>
      {accesosAbierto && <AccesosDeClientes onCerrar={() => setAccesosAbierto(false)} />}

      {esAdmin && notion?.permitido && <EstadoDeNotionPanel notion={notion} sincronizando={sincronizando} onSincronizar={() => void sincronizar()} />}

      {GRUPOS.map((g) => {
        const lista = datos.clientes.filter((c) => c.grupo === g)
        if (lista.length === 0) return null
        return <GrupoDeTarjetas key={g} grupo={g} clientes={lista} estadisticas={datos.estadisticas} personas={datos.personas} favoritos={prefs.favoritos} onAbrir={(id) => router.push(`/dashboard/tareas-clientes/${id}`)} onFavorito={(id) => void guardarPrefs({ favoritos: prefs.favoritos.includes(id) ? prefs.favoritos.filter((x) => x !== id) : [...prefs.favoritos, id] })} onOrden={(ids) => void pedir(`${BASE}/clientes/orden`, { metodo: 'POST', cuerpo: { ids } }).catch((e: Error) => toast.error(e.message))} onReordenado={(ids) => setDatos((d) => (d ? { ...d, clientes: [...d.clientes].sort((a, b) => (a.grupo === b.grupo && ids.includes(a.id) && ids.includes(b.id) ? ids.indexOf(a.id) - ids.indexOf(b.id) : 0)) } : d))} />
      })}
    </div>
  )
}

function Cifra({ icono, valor, nombre, alerta }: { icono: React.ReactNode; valor: number; nombre: string; alerta?: boolean }) {
  return (
    <div className="tc-cifra" data-alerta={alerta ? 'true' : undefined}>
      {icono}
      <span className="text-[22px] font-semibold tabular-nums leading-none" style={{ color: '#fff' }}>{valor}</span>
      <span className="text-[11.5px]" style={{ color: 'rgba(255,255,255,0.78)' }}>{nombre}</span>
    </div>
  )
}

function Atajo({ icono, titulo, detalle, onClick, color, alerta }: { icono: React.ReactNode; titulo: string; detalle: string; onClick: () => void; color: string; alerta?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="tc-atajo" style={{ '--tono': `var(--tc-${color})` } as CSSProperties}>
      <span className="tc-atajo-icono">{icono}</span>
      <span className="min-w-0 flex-1 text-left"><span className="block text-[14px] font-semibold text-[var(--ls-t1)]">{titulo}</span><span className={`block truncate text-[12px] ${alerta ? 'text-[var(--ls-e-rojo)]' : 'text-[var(--ls-t3)]'}`}>{detalle}</span></span>
    </button>
  )
}

function EstadoDeNotionPanel({ notion, sincronizando, onSincronizar }: { notion: EstadoDeNotion; sincronizando: boolean; onSincronizar: () => void }) {
  const ultima = (notion.clientes ?? []).map((c) => c.sync_ultima).filter((x): x is string => Boolean(x)).sort().at(-1)
  const fallos = (notion.clientes ?? []).filter((c) => c.sync_error)
  return (
    <section className="tc-notion" aria-label="Conexión con Notion">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--ls-t1)]">
          {notion.clave ? <span className="tc-punto" style={{ '--tono': 'var(--ls-e-verde)' } as CSSProperties} /> : <CloudOff className="h-3.5 w-3.5 text-[var(--ls-e-ambar)]" />}
          Notion {notion.clave ? 'conectado' : 'sin conectar'}
          {notion.integracion?.espacio ? <span className="font-normal text-[var(--ls-t3)]">· {notion.integracion.espacio}</span> : null}
        </span>
        <span className="text-[12px] text-[var(--ls-t3)]">{notion.clave ? (notion.escritura ? 'Lee y escribe' : 'Solo lee (la escritura está apagada)') : 'Falta la clave NOTION_TOKEN en el servidor'}</span>
        {ultima && <span className="text-[12px] text-[var(--ls-t4)]">Última lectura {new Date(ultima).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}</span>}
        {(notion.cola?.pendientes ?? 0) > 0 && <span className="text-[12px] text-[var(--ls-e-ambar)]">{notion.cola?.pendientes} cambios esperando salir</span>}
        {fallos.length > 0 && <span className="text-[12px] text-[var(--ls-e-rojo)]" title={fallos.map((f) => `${f.nombre}: ${f.sync_error}`).join('\n')}>{fallos.length} clientes con error</span>}
        {notion.integracion?.error && <span className="text-[12px] text-[var(--ls-e-rojo)]">{notion.integracion.error}</span>}
        {notion.webhook?.token && (
          <span className="flex items-center gap-1.5 text-[12px] text-[var(--ls-t3)]">
            Código de verificación del aviso de Notion:
            <button type="button" onClick={() => { void navigator.clipboard.writeText(notion.webhook?.token ?? ''); toast.success('Código copiado') }} className="rounded-[5px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--ls-t1)] hover:bg-[var(--ls-sup3)]" title="Pégalo en Notion para verificar el webhook">{notion.webhook.token.slice(0, 14)}… copiar</button>
          </span>
        )}
        <button type="button" disabled={!notion.clave || sincronizando} onClick={onSincronizar} className="tc-boton-suave ml-auto">{sincronizando ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Sincronizar ahora</button>
      </div>
    </section>
  )
}

function GrupoDeTarjetas({ grupo, clientes, estadisticas, personas, favoritos, onAbrir, onFavorito, onOrden, onReordenado }: { grupo: GrupoDeCliente; clientes: ClienteTC[]; estadisticas: Record<string, EstadisticasDeCliente>; personas: DatosDeInicio['personas']; favoritos: string[]; onAbrir: (id: string) => void; onFavorito: (id: string) => void; onOrden: (ids: string[]) => void; onReordenado: (ids: string[]) => void }) {
  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const alSoltar = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const ids = clientes.map((c) => c.id)
    const nuevo = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)))
    onReordenado(nuevo)
    onOrden(nuevo)
  }
  return (
    <section className="mt-9" aria-label={ETIQUETA_DE_GRUPO[grupo]}>
      <h2 className="tc-grupo-titulo" style={{ '--tono': `var(--tc-${COLOR_DE_GRUPO[grupo]})` } as CSSProperties}><span className="tc-punto" />{ETIQUETA_DE_GRUPO[grupo]}<span className="font-normal tracking-normal text-[var(--ls-t4)]">{clientes.length}</span></h2>
      <DndContext sensors={sensores} collisionDetection={closestCenter} onDragEnd={alSoltar}>
        <SortableContext items={clientes.map((c) => c.id)} strategy={rectSortingStrategy}>
          <div className="tc-rejilla">
            {clientes.map((c, i) => <Tarjeta key={c.id} cliente={c} e={estadisticas[c.id]} personas={personas} favorito={favoritos.includes(c.id)} indice={i} onAbrir={onAbrir} onFavorito={onFavorito} />)}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  )
}

function Tarjeta({ cliente: c, e, personas, favorito, indice, onAbrir, onFavorito }: { cliente: ClienteTC; e: EstadisticasDeCliente | undefined; personas: DatosDeInicio['personas']; favorito: boolean; indice: number; onAbrir: (id: string) => void; onFavorito: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: c.id })
  const total = e?.total ?? 0
  const pct = total > 0 ? Math.round(((e?.hechas ?? 0) / total) * 100) : 0
  const portada = estiloDePortada(c.portada)
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, '--tono': `var(--tc-${c.color || 'orange'})`, '--i': Math.min(indice, 12) } as CSSProperties} {...attributes} {...listeners} role="link" tabIndex={0} aria-label={`Abrir ${c.nombre}`} onClick={() => onAbrir(c.id)} onKeyDown={(ev) => { if (ev.key === 'Enter') onAbrir(c.id) }} data-arrastrando={isDragging ? 'true' : undefined} className="tc-cliente">
      <div className="tc-cliente-portada" style={portada} data-vacia={portada ? undefined : 'true'} />
      <div className="tc-cliente-cuerpo">
        <div className="flex items-start gap-2.5">
          <span className="tc-cliente-emoji">{c.icono ?? '📋'}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14.5px] font-semibold tracking-[-0.006em] text-[var(--ls-t1)]">{c.nombre}</p>
            <p className="truncate text-[11.5px] text-[var(--ls-t3)]">{c.descripcion || (c.notion_ds_id ? 'Conectado con Notion' : 'Solo en el ERP')}</p>
          </div>
          <button type="button" aria-label={favorito ? 'Quitar de favoritos' : 'Añadir a favoritos'} aria-pressed={favorito} onClick={(ev) => { ev.stopPropagation(); onFavorito(c.id) }} onPointerDown={(ev) => ev.stopPropagation()} className="tc-lat-estrella !static" data-puesta={favorito ? 'true' : undefined}><Star className="h-3.5 w-3.5" /></button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11.5px] tabular-nums">
          <span className="tc-mini" style={{ '--tono': 'var(--tc-blue)' } as CSSProperties}>{e?.enCurso ?? 0} en curso</span>
          <span className="tc-mini" style={{ '--tono': 'var(--tc-yellow)' } as CSSProperties}>{e?.pendientes ?? 0} pendientes</span>
          {(e?.vencidas ?? 0) > 0 && <span className="tc-mini" style={{ '--tono': 'var(--tc-red)' } as CSSProperties}><Flame className="h-3 w-3" /> {e?.vencidas} vencidas</span>}
        </div>
        <div className="mt-3 flex items-center gap-2.5">
          <span className="tc-progreso" style={{ '--p': `${pct}%` } as CSSProperties} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${pct}% hecho`} />
          <span className="w-9 text-right text-[11.5px] tabular-nums text-[var(--ls-t3)]">{pct}%</span>
          <PilaDeAvatares ids={e?.responsables ?? []} personas={personas} maximo={3} tamano={20} />
        </div>
        {c.sync_error && <p className="mt-2 flex items-center gap-1 text-[11px] text-[var(--ls-e-ambar)]" title={c.sync_error}><AlertTriangle className="h-3 w-3" /> Notion con problemas</p>}
      </div>
    </div>
  )
}
