'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlertTriangle, ArrowUpRight, Bot, CheckCircle2, Flame, ImageIcon, LayoutGrid, LogOut, Palette, Search, ShieldCheck, Star, Sun, Timer, UserCheck, X } from 'lucide-react'
import { toast } from 'sonner'
import type { EstadisticasDeCliente } from '@/lib/tareas-clientes/servidor'
import { ETIQUETA_DE_GRUPO, type ClienteTC, type GrupoDeCliente, type Portada as PortadaGuardada } from '@/lib/tareas-clientes/tipos'
import { sinAcentos } from '@/lib/tareas-clientes/busqueda'
import { saludoDe } from '@/lib/inicio/saludo'
import type { Conectado } from '@/lib/tareas-clientes/presencia'
import { BASE, pedir, type DatosDeInicio, type Preferencias } from './api'
import { FondoAnimado, SelectorDePortada, estiloDePortada, fondoNecesitaCortina } from './Portada'
import { AccesosDeClientes } from './AccesosDeClientes'
import { SalidaDeNotion } from './SalidaDeNotion'
import { TareasAutomaticas } from './TareasAutomaticas'
import { PilaDeAvatares } from './ui'
import { usePresencia } from './PresenciaProvider'
import { EnLinea, Presentes } from './PresenciaVisual'

/**
 * LA PÁGINA DE INICIO DE TAREAS DE CLIENTES, a todo el ancho: una portada con las cifras en vivo, los accesos rápidos y todos los clientes en tarjetas (por grupos). Las tarjetas se
 * reordenan arrastrándolas; pulsar una abre el espacio de ese cliente. Los datos llegan YA con la página (los lee el servidor al servirla) y se refrescan por detrás: no hay pantalla
 * de carga ni una segunda petición. Todo lo que se mueve va dentro de `prefers-reduced-motion: no-preference`.
 */

const GRUPOS: GrupoDeCliente[] = ['agencia', 'marcas_eeuu', 'otros']
const COLOR_DE_GRUPO: Record<GrupoDeCliente, string> = { agencia: 'orange', marcas_eeuu: 'blue', otros: 'gray' }

/** Un número que sube hasta su valor (y se actualiza suave cuando cambia). Sin movimiento si la persona lo pidió o la pestaña no se ve */
function Numero({ valor }: { valor: number }) {
  const [mostrado, setMostrado] = useState(valor)
  const desde = useRef(valor)
  const primera = useRef(true)
  useEffect(() => {
    const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.visibilityState !== 'visible'
    if (quieto) {
      desde.current = valor
      setMostrado(valor)
      return
    }
    const inicio = primera.current ? 0 : desde.current
    primera.current = false
    const t0 = performance.now()
    const duracion = 900
    let marco = 0
    const paso = (t: number) => {
      const k = Math.min(1, (t - t0) / duracion)
      const suave = 1 - Math.pow(1 - k, 3)
      setMostrado(Math.round(inicio + (valor - inicio) * suave))
      if (k < 1) marco = requestAnimationFrame(paso)
      else desde.current = valor
    }
    marco = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(marco)
  }, [valor])
  return <>{mostrado}</>
}

export function Inicio({ esAdmin, inicial = null }: { esAdmin: boolean; inicial?: DatosDeInicio | null }) {
  const router = useRouter()
  const [datos, setDatos] = useState<DatosDeInicio | null>(inicial)
  const [error, setError] = useState<string | null>(null)
  const [accesosAbierto, setAccesosAbierto] = useState(false)
  const [automaticasAbierto, setAutomaticasAbierto] = useState(false)
  const [salidaAbierta, setSalidaAbierta] = useState(false)
  const [filtro, setFiltro] = useState('')
  const [soloVencidas, setSoloVencidas] = useState(false)
  const { deCliente } = usePresencia()

  const cargar = useCallback(async () => {
    try {
      setDatos(await pedir<DatosDeInicio>(`${BASE}/inicio`))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se han podido leer los clientes')
    }
  }, [])

  // Los datos ya vienen con la página: se leen por detrás cada minuto (y al volver a la pestaña); solo se piden al abrir si el servidor no los trajo
  // Los casos de cumplimiento sin resolver de cada cliente: salen en su tarjeta
  const [casos, setCasos] = useState<Record<string, number>>({})
  useEffect(() => {
    pedir<{ porCliente: Record<string, number> }>(`${BASE}/casos?resumen=1`).then((r) => setCasos(r.porCliente)).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!inicial) void cargar()
    const t = setInterval(() => document.visibilityState === 'visible' && void cargar(), 60_000)
    const alVolver = () => document.visibilityState === 'visible' && void cargar()
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [cargar, inicial])

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
    const t = { abiertas: 0, enCurso: 0, pendientes: 0, vencidas: 0, hechas: 0, total: 0 }
    for (const e of Object.values(datos?.estadisticas ?? {})) {
      t.abiertas += e.pendientes + e.enCurso
      t.enCurso += e.enCurso
      t.pendientes += e.pendientes
      t.vencidas += e.vencidas
      t.hechas += e.hechas
      t.total += e.total
    }
    return t
  }, [datos?.estadisticas])

  const visibles = useMemo(() => {
    const q = sinAcentos(filtro.trim())
    return (datos?.clientes ?? []).filter((c) => (!q || sinAcentos(c.nombre).includes(q)) && (!soloVencidas || (datos?.estadisticas[c.id]?.vencidas ?? 0) > 0))
  }, [datos?.clientes, datos?.estadisticas, filtro, soloVencidas])
  const filtrando = filtro.trim() !== '' || soloVencidas

  if (error && !datos) {
    return (
      <div className="tc-inicio flex items-center justify-center" role="alert">
        <div className="flex flex-col items-center gap-3 text-center"><AlertTriangle className="h-6 w-6 text-[var(--ls-e-ambar)]" /><p className="text-[13.5px] text-[var(--ls-t2)]">{error}</p><button type="button" onClick={() => void cargar()} className="tc-boton-primario">Reintentar</button></div>
      </div>
    )
  }
  if (!datos) {
    return (
      <div className="tc-inicio" role="status" aria-label="Cargando los clientes">
        <div className="tc-esqueleto h-[190px] rounded-[22px]" />
        <div className="tc-ini-rejilla mt-6">{Array.from({ length: 8 }, (_, i) => <div key={i} className="tc-esqueleto h-[170px]" />)}</div>
      </div>
    )
  }

  const total = Math.max(totales.total, 1)
  return (
    <div className="tc-inicio" data-fondo={fondoNecesitaCortina(prefs.fondo) ? 'true' : undefined} style={estiloDePortada(prefs.fondo, true)}>
      <FondoAnimado valor={prefs.fondo} />

      <section className="tc-hero tc-ini-hero" style={estiloDePortada(prefs.portada)} data-vacia={prefs.portada.tipo ? undefined : 'true'}>
        <div className="tc-hero-velo" />
        <div className="tc-ini-hero-cuerpo">
          <div className="min-w-0 flex-1">
            <p className="tc-hero-sobre">{saludoDe(new Date().getHours())} · Liberty Seller</p>
            <h1 className="tc-hero-titulo">Tareas de clientes</h1>
            <p className="tc-hero-texto">{datos.clientes.length} clientes · {totales.abiertas} tareas por hacer{totales.vencidas > 0 ? `, ${totales.vencidas} ya vencidas` : ''}.</p>
            <div className="mt-3 flex"><EnLinea equipo={datos.personas} nombreDeCliente={(id) => datos.clientes.find((c) => c.id === id)?.nombre} tituloDeTarea={() => undefined} /></div>
            <div className="tc-ini-salud" role="img" aria-label={`${totales.hechas} hechas, ${totales.enCurso} en curso, ${totales.pendientes} pendientes`}>
              <span style={{ '--w': `${(totales.hechas / total) * 100}%`, '--c': 'var(--ls-e-verde)' } as CSSProperties} />
              <span style={{ '--w': `${(totales.enCurso / total) * 100}%`, '--c': 'var(--tc-blue)' } as CSSProperties} />
              <span style={{ '--w': `${(totales.pendientes / total) * 100}%`, '--c': 'var(--tc-yellow)' } as CSSProperties} />
            </div>
          </div>
          <div className="tc-ini-cifras" aria-label="Resumen">
            <Cifra icono={<LayoutGrid className="h-4 w-4" />} valor={totales.abiertas} nombre="por hacer" tono="blue" />
            <Cifra icono={<Timer className="h-4 w-4" />} valor={totales.enCurso} nombre="en curso" tono="purple" />
            <Cifra icono={<Flame className="h-4 w-4" />} valor={totales.vencidas} nombre="vencidas" tono="red" alerta={totales.vencidas > 0} />
            <Cifra icono={<CheckCircle2 className="h-4 w-4" />} valor={totales.hechas} nombre="hechas" tono="green" />
          </div>
        </div>
        <div className="tc-cover-botones">
          <SelectorDePortada valor={prefs.portada} titulo="Tu portada" onElegir={(p: PortadaGuardada) => void guardarPrefs({ portada: p })}><button type="button" className="tc-boton-cristal"><ImageIcon className="h-3 w-3" /> Portada</button></SelectorDePortada>
          <SelectorDePortada animados valor={prefs.fondo} titulo="Tu fondo" onElegir={(p: PortadaGuardada) => void guardarPrefs({ fondo: p })}><button type="button" className="tc-boton-cristal"><Palette className="h-3 w-3" /> Fondo</button></SelectorDePortada>
        </div>
      </section>

      <div className="tc-ini-atajos">
        <Atajo grande icono={<Sun className="h-5 w-5" />} titulo="Mi día" detalle="Tu briefing, tus tareas, comentarios y calendario" onClick={() => router.push('/dashboard/tareas-clientes/mi-dia')} color="orange" i={0} />
        <Atajo grande icono={<LayoutGrid className="h-5 w-5" />} titulo="Todas las tareas" detalle={`${totales.abiertas} por hacer en ${datos.clientes.length} clientes`} onClick={() => router.push('/dashboard/tareas-clientes/todas')} color="blue" i={1} />
        <Atajo grande icono={<UserCheck className="h-5 w-5" />} titulo="Mis tareas" detalle={datos.mias.abiertas === 0 ? 'Nada pendiente' : `${datos.mias.abiertas} por hacer${datos.mias.vencidas > 0 ? ` · ${datos.mias.vencidas} vencidas` : ''}`} alerta={datos.mias.vencidas > 0} onClick={() => router.push('/dashboard/tareas-clientes/mis-tareas')} color="green" i={2} />
        {esAdmin && (
          <div className="tc-ini-herramientas">
            <Atajo icono={<ShieldCheck className="h-4 w-4" />} titulo="Quién ve qué" detalle="Limitar a cada persona a unos clientes" onClick={() => setAccesosAbierto(true)} color="purple" i={3} />
            <Atajo icono={<Bot className="h-4 w-4" />} titulo="Tareas automáticas" detalle="Que el ERP abra tareas con las alertas" onClick={() => setAutomaticasAbierto(true)} color="blue" i={4} />
            <Atajo icono={<LogOut className="h-4 w-4" />} titulo="Salir de Notion" detalle="Qué falta para dejarlo en solo lectura" onClick={() => setSalidaAbierta(true)} color="orange" i={5} />
          </div>
        )}
      </div>
      {accesosAbierto && <AccesosDeClientes onCerrar={() => setAccesosAbierto(false)} />}
      {salidaAbierta && <SalidaDeNotion onCerrar={() => setSalidaAbierta(false)} />}
      {automaticasAbierto && <TareasAutomaticas personas={datos.personas} onCerrar={() => setAutomaticasAbierto(false)} />}

      <div className="tc-ini-filtros">
        <label className="tc-ini-buscar">
          <Search className="h-4 w-4 text-[var(--ls-t4)]" />
          <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar un cliente…" aria-label="Buscar un cliente" />
          {filtro && <button type="button" aria-label="Borrar la búsqueda" onClick={() => setFiltro('')}><X className="h-3.5 w-3.5 text-[var(--ls-t4)]" /></button>}
        </label>
        <button type="button" aria-pressed={soloVencidas} onClick={() => setSoloVencidas((v) => !v)} className="tc-ini-chip" data-on={soloVencidas ? 'true' : undefined}><Flame className="h-3.5 w-3.5" /> Con tareas vencidas</button>
        {filtrando && <span className="text-[12px] text-[var(--ls-t3)]">{visibles.length} de {datos.clientes.length} clientes</span>}
      </div>

      {filtrando && visibles.length === 0 && <p className="mt-10 text-center text-[13.5px] text-[var(--ls-t3)]">Ningún cliente coincide.</p>}
      {GRUPOS.map((g) => {
        const lista = visibles.filter((c) => c.grupo === g)
        if (lista.length === 0) return null
        return (
          <GrupoDeTarjetas
            key={g}
            viendoPorCliente={deCliente}
            grupo={g}
            clientes={lista}
            ordenable={!filtrando}
            estadisticas={datos.estadisticas}
            casos={casos}
            personas={datos.personas}
            favoritos={prefs.favoritos}
            onAbrir={(id) => router.push(`/dashboard/tareas-clientes/${id}`)}
            onFavorito={(id) => void guardarPrefs({ favoritos: prefs.favoritos.includes(id) ? prefs.favoritos.filter((x) => x !== id) : [...prefs.favoritos, id] })}
            onOrden={(ids) => void pedir(`${BASE}/clientes/orden`, { metodo: 'POST', cuerpo: { ids } }).catch((e: Error) => toast.error(e.message))}
            onReordenado={(ids) => setDatos((d) => (d ? { ...d, clientes: [...d.clientes].sort((a, b) => (a.grupo === b.grupo && ids.includes(a.id) && ids.includes(b.id) ? ids.indexOf(a.id) - ids.indexOf(b.id) : 0)) } : d))}
          />
        )
      })}
    </div>
  )
}

function Cifra({ icono, valor, nombre, tono, alerta }: { icono: React.ReactNode; valor: number; nombre: string; tono: string; alerta?: boolean }) {
  return (
    <div className="tc-ini-cifra" data-alerta={alerta ? 'true' : undefined} style={{ '--tono': `var(--tc-${tono})` } as CSSProperties}>
      <span className="tc-ini-cifra-icono">{icono}</span>
      <span className="tc-ini-cifra-valor"><Numero valor={valor} /></span>
      <span className="tc-ini-cifra-nombre">{nombre}</span>
    </div>
  )
}

function Atajo({ icono, titulo, detalle, onClick, color, alerta, grande, i = 0 }: { icono: React.ReactNode; titulo: string; detalle: string; onClick: () => void; color: string; alerta?: boolean; grande?: boolean; i?: number }) {
  return (
    <button type="button" onClick={onClick} className="tc-ini-atajo" data-grande={grande ? 'true' : undefined} style={{ '--tono': `var(--tc-${color})`, '--i': i } as CSSProperties}>
      <span className="tc-ini-atajo-icono">{icono}</span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[14.5px] font-semibold text-[var(--ls-t1)]">{titulo}</span>
        <span className={`block truncate text-[12px] ${alerta ? 'font-medium text-[var(--ls-e-rojo)]' : 'text-[var(--ls-t3)]'}`}>{detalle}</span>
      </span>
      <ArrowUpRight className="tc-ini-atajo-flecha h-4 w-4" />
    </button>
  )
}

function GrupoDeTarjetas({ viendoPorCliente, grupo, clientes, ordenable, estadisticas, casos, personas, favoritos, onAbrir, onFavorito, onOrden, onReordenado }: { viendoPorCliente: ReadonlyMap<string, Conectado[]>; grupo: GrupoDeCliente; clientes: ClienteTC[]; ordenable: boolean; estadisticas: Record<string, EstadisticasDeCliente>; casos: Record<string, number>; personas: DatosDeInicio['personas']; favoritos: string[]; onAbrir: (id: string) => void; onFavorito: (id: string) => void; onOrden: (ids: string[]) => void; onReordenado: (ids: string[]) => void }) {
  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const alSoltar = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const ids = clientes.map((c) => c.id)
    const nuevo = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)))
    onReordenado(nuevo)
    onOrden(nuevo)
  }
  const tarjetas = clientes.map((c, i) => <Tarjeta key={c.id} cliente={c} e={estadisticas[c.id]} casos={casos[c.id] ?? 0} personas={personas} viendo={viendoPorCliente.get(c.id) ?? []} favorito={favoritos.includes(c.id)} indice={i} ordenable={ordenable} onAbrir={onAbrir} onFavorito={onFavorito} />)
  return (
    <section className="tc-ini-grupo" aria-label={ETIQUETA_DE_GRUPO[grupo]}>
      <h2 className="tc-grupo-titulo" style={{ '--tono': `var(--tc-${COLOR_DE_GRUPO[grupo]})` } as CSSProperties}><span className="tc-punto" />{ETIQUETA_DE_GRUPO[grupo]}<span className="font-normal tracking-normal text-[var(--ls-t4)]">{clientes.length}</span><span className="tc-ini-linea" /></h2>
      {ordenable ? (
        <DndContext sensors={sensores} collisionDetection={closestCenter} onDragEnd={alSoltar}>
          <SortableContext items={clientes.map((c) => c.id)} strategy={rectSortingStrategy}>
            <div className="tc-ini-rejilla">{tarjetas}</div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="tc-ini-rejilla">{tarjetas}</div>
      )}
    </section>
  )
}

function Tarjeta({ viendo, cliente: c, e, casos, personas, favorito, indice, ordenable, onAbrir, onFavorito }: { viendo: Conectado[]; cliente: ClienteTC; e: EstadisticasDeCliente | undefined; casos: number; personas: DatosDeInicio['personas']; favorito: boolean; indice: number; ordenable: boolean; onAbrir: (id: string) => void; onFavorito: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: c.id, disabled: !ordenable })
  const total = e?.total ?? 0
  const hechas = e?.hechas ?? 0
  const pct = total > 0 ? Math.round((hechas / total) * 100) : 0
  const portada = estiloDePortada(c.portada)
  const parte = (n: number) => `${total > 0 ? (n / total) * 100 : 0}%`
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, '--tono': `var(--tc-${c.color || 'orange'})`, '--i': Math.min(indice, 14) } as CSSProperties}
      {...attributes}
      {...listeners}
      role="link"
      tabIndex={0}
      aria-label={`Abrir ${c.nombre}`}
      data-arrastrando={isDragging ? 'true' : undefined}
      onClick={() => !isDragging && onAbrir(c.id)}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter') onAbrir(c.id)
      }}
      className="tc-ini-cliente"
    >
      <div className="tc-ini-cliente-banda" style={portada} data-vacia={portada ? undefined : 'true'} />
      <div className="tc-ini-cliente-cuerpo">
        <div className="flex items-start gap-3">
          <span className="tc-ini-emoji">{c.icono ?? '📋'}</span>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="truncate text-[15.5px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)]">{c.nombre}</p>
            <p className="truncate text-[12px] text-[var(--ls-t3)]">{c.descripcion || `${total} ${total === 1 ? 'tarea' : 'tareas'}`}</p>
          </div>
          <button type="button" aria-label={favorito ? 'Quitar de favoritos' : 'Añadir a favoritos'} aria-pressed={favorito} onClick={(ev) => { ev.stopPropagation(); onFavorito(c.id) }} onPointerDown={(ev) => ev.stopPropagation()} className="tc-ini-estrella" data-puesta={favorito ? 'true' : undefined}><Star className="h-4 w-4" /></button>
        </div>

        <div className="tc-ini-barra" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${pct}% hecho`}>
          <span style={{ '--w': parte(hechas), '--c': 'var(--ls-e-verde)' } as CSSProperties} />
          <span style={{ '--w': parte(e?.enCurso ?? 0), '--c': 'var(--tc-blue)' } as CSSProperties} />
          <span style={{ '--w': parte(e?.pendientes ?? 0), '--c': 'var(--tc-yellow)' } as CSSProperties} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] tabular-nums">
          <span className="tc-ini-dato"><i style={{ background: 'var(--tc-blue)' }} /><b>{e?.enCurso ?? 0}</b> en curso</span>
          <span className="tc-ini-dato"><i style={{ background: 'var(--tc-yellow)' }} /><b>{e?.pendientes ?? 0}</b> pendientes</span>
          {(e?.vencidas ?? 0) > 0 && <span className="tc-ini-vencidas"><Flame className="h-3 w-3" /> {e?.vencidas} vencidas</span>}
          {casos > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-px text-[11.5px] font-semibold text-[var(--tc-yellow)]" style={{ background: 'color-mix(in srgb, var(--tc-yellow) 14%, transparent)' }} title="Casos de cumplimiento normativo sin resolver">
              <ShieldCheck className="h-3 w-3" /> {casos} {casos === 1 ? 'caso' : 'casos'}
            </span>
          )}
          <span className="ml-auto flex items-center gap-2"><span className="text-[12px] font-semibold text-[var(--ls-t2)]">{pct}%</span><PilaDeAvatares ids={e?.responsables ?? []} personas={personas} maximo={3} tamano={22} /></span>
        </div>
        {c.sync_error && <p className="mt-2 flex items-center gap-1 text-[11px] text-[var(--ls-e-ambar)]" title={c.sync_error}><AlertTriangle className="h-3 w-3" /> Con problemas de sincronización</p>}
      </div>
      {viendo.length > 0 && <span className="tc-ini-cliente-presentes"><Presentes personas={viendo} max={3} tamano={20} etiqueta="Viendo" /> viendo ahora</span>}
      <ArrowUpRight className="tc-ini-cliente-flecha h-4 w-4" />
    </div>
  )
}
