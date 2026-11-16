'use client'

import { MotionConfig, motion } from 'framer-motion'
import { AlertTriangle, Bell, BellOff, Check, ChevronDown, Inbox, MessageSquare, User, UserCheck } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Boton, FOCO, PanelLateral } from '@/components/ui-ls'
import { hastaDeDuracion, type CambioDePreferencia } from '@/lib/correo/preferencias'
import { direccionCorta } from '@/lib/correo/marcas'
import type { BuzonVisible, Duracion } from '@/lib/correo/tipos'
import { cn } from '@/lib/utils'
import type { PropsDeElegirMisCorreos } from './contratos'
import { enviarJson, pedir } from './api'
import { MenuDeSilencio, PuntoDeBuzon, textoDeSilencio } from './piezas'

/**
 * «ELIGE TUS CORREOS» (spec 1.10). PanelLateral con tres secciones: TUYOS (esMio), ASIGNADOS A TI (asignado) y DEL EQUIPO (el resto que puedes leer).
 * Cada fila: casilla de 44 px (¿está en «Mis correos»?), punto de color, dirección, de quién es, sin leer y la campana (Avisarme / Silenciar 8 h, hasta
 * mañana, 1 semana o siempre). Nada se manda hasta «Guardar»: entonces UN solo onGuardar con todos los CambioDePreferencia.
 * Con `disponible = false` (falta la migración 318) se enseña la banda y no se puede guardar.
 */

/** Lo que la persona ha marcado en el panel para un buzón (sin guardar) */
export interface EleccionDeBuzon {
  enMisCorreos: boolean
  /** undefined = no ha tocado la campana */
  silencio?: Duracion | 'quitar'
}

export type Eleccion = Record<string, EleccionDeBuzon>

/* ------------------------------------------------------------------ */
/* Lógica pura (con prueba en ElegirMisCorreos.prueba.ts)               */
/* ------------------------------------------------------------------ */

const porDireccion = (a: BuzonVisible, b: BuzonVisible) => a.direccion.localeCompare(b.direccion, 'es')

/** Las tres secciones del panel. Un buzón propio y asignado (no debería pasar) cuenta como tuyo */
export function seccionesDeEleccion(buzones: readonly BuzonVisible[]): { tuyos: BuzonVisible[]; asignados: BuzonVisible[]; equipo: BuzonVisible[] } {
  const tuyos = buzones.filter((b) => b.esMio).sort(porDireccion)
  const asignados = buzones.filter((b) => !b.esMio && b.asignado).sort(porDireccion)
  const equipo = buzones
    .filter((b) => !b.esMio && !b.asignado)
    .sort((a, b) => (a.propietario.nombre || '').localeCompare(b.propietario.nombre || '', 'es') || porDireccion(a, b))
  return { tuyos, asignados, equipo }
}

/** Cómo empieza el panel al abrirse: lo que hay ahora */
export function eleccionInicial(buzones: readonly BuzonVisible[]): Eleccion {
  const e: Eleccion = {}
  for (const b of buzones) e[b.id] = { enMisCorreos: b.enMisCorreos }
  return e
}

/** Si un buzón queda silenciado con lo elegido (y hasta cuándo, para el texto) */
export function silencioEfectivo(b: Pick<BuzonVisible, 'silenciado' | 'silenciadoHasta'>, e: EleccionDeBuzon | undefined, ahora: Date): { silenciado: boolean; hasta: string | null } {
  if (!e?.silencio) return { silenciado: b.silenciado, hasta: b.silenciado ? b.silenciadoHasta : null }
  if (e.silencio === 'quitar') return { silenciado: false, hasta: null }
  return { silenciado: true, hasta: hastaDeDuracion(e.silencio, ahora) }
}

/**
 * Los cambios que hay que mandar: uno por buzón que ha cambiado, con solo lo que ha cambiado.
 *   · enMisCorreos solo si es distinto de lo de ahora
 *   · silencio: una duración siempre (vuelve a contar desde ahora); 'quitar' solo si estaba silenciado
 * Los buzones que ya no están en `buzones` (se ha dejado de poder leerlos) no se mandan.
 */
export function cambiosDeEleccion(buzones: readonly BuzonVisible[], eleccion: Eleccion): CambioDePreferencia[] {
  const cambios: CambioDePreferencia[] = []
  for (const b of buzones) {
    const e = eleccion[b.id]
    if (!e) continue
    const cambio: { buzonId: string; enMisCorreos?: boolean; silencio?: Duracion | 'quitar' } = { buzonId: b.id }
    if (e.enMisCorreos !== b.enMisCorreos) cambio.enMisCorreos = e.enMisCorreos
    if (e.silencio && (e.silencio !== 'quitar' || b.silenciado)) cambio.silencio = e.silencio
    if (cambio.enMisCorreos !== undefined || cambio.silencio !== undefined) cambios.push(cambio)
  }
  return cambios
}

/** Lo que devuelve GET /api/correo/preferencias (lo que aquí se usa) */
export interface DatosDeSilenciados {
  remitentes: Array<{ direccion: string; hasta: string | null }>
  hilos: Array<{ hiloId: string; asunto: string; hasta: string | null }>
  disponible: boolean
}

/** Un silencio personal que se puede reactivar desde «Silenciados» */
export type Silenciado = { tipo: 'remitente'; clave: string; texto: string; hasta: string | null } | { tipo: 'hilo'; clave: string; texto: string; hasta: string | null }

/**
 * «Silenciados»: primero los remitentes y luego las conversaciones, cada grupo por orden alfabético. Lo ya reactivado (por su clave
 * `tipo:clave`) no sale. Lo que no sea texto se descarta: la respuesta viene de la red.
 */
export function silenciadosParaPantalla(datos: Partial<DatosDeSilenciados> | null | undefined, reactivados: ReadonlySet<string> = new Set()): Silenciado[] {
  const remitentes: Silenciado[] = (Array.isArray(datos?.remitentes) ? datos.remitentes : [])
    .filter((r) => typeof r?.direccion === 'string' && r.direccion.trim() !== '')
    .map((r) => ({ tipo: 'remitente' as const, clave: r.direccion, texto: r.direccion, hasta: r.hasta ?? null }))
    .sort((a, b) => a.texto.localeCompare(b.texto, 'es'))
  const hilos: Silenciado[] = (Array.isArray(datos?.hilos) ? datos.hilos : [])
    .filter((h) => typeof h?.hiloId === 'string' && h.hiloId !== '')
    .map((h) => ({ tipo: 'hilo' as const, clave: h.hiloId, texto: typeof h.asunto === 'string' && h.asunto.trim() ? h.asunto.trim() : '(sin asunto)', hasta: h.hasta ?? null }))
    .sort((a, b) => a.texto.localeCompare(b.texto, 'es'))
  return [...remitentes, ...hilos].filter((x) => !reactivados.has(`${x.tipo}:${x.clave}`))
}

/* ------------------------------------------------------------------ */
/* Pantalla                                                            */
/* ------------------------------------------------------------------ */

const ROTULO = 'px-1 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t3)]'

interface FilaProps {
  buzon: BuzonVisible
  eleccion: EleccionDeBuzon
  ahora: Date
  disponible: boolean
  onMarcar: (v: boolean) => void
  onSilencio: (s: Duracion | 'quitar') => void
}

function Fila({ buzon, eleccion, ahora, disponible, onMarcar, onSilencio }: FilaProps) {
  const marcado = eleccion.enMisCorreos
  const { silenciado, hasta } = silencioEfectivo(buzon, eleccion, ahora)
  const cuenta = Math.max(0, buzon.hilosSinLeerMios || 0)
  const alerta = buzon.credencialesInvalidas ? 'Contraseña rechazada' : !buzon.conectado ? 'Desconectado' : null
  const dueno = buzon.esMio ? null : buzon.propietario.nombre ? `de ${buzon.propietario.nombre.split(' ')[0]}` : null

  return (
    <li className="flex items-center gap-1 rounded-[10px] transition-colors hover:bg-[var(--ls-sup2)]">
      <button
        type="button"
        role="checkbox"
        aria-checked={marcado}
        disabled={!disponible}
        onClick={() => onMarcar(!marcado)}
        className={cn('flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-[10px] px-2 py-1.5 text-left disabled:cursor-not-allowed', FOCO)}
      >
        <span
          aria-hidden
          className={cn(
            'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors',
            marcado ? 'border-[var(--ls-acc-borde)] bg-[var(--ls-acc-relleno)] text-[var(--ls-acc-tinta)]' : 'border-[var(--ls-linea2)] bg-[var(--ls-sup2)]',
          )}
        >
          {marcado && (
            <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 600, damping: 30 }}>
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
            </motion.span>
          )}
        </span>
        <motion.span className="flex min-w-0 flex-1 items-center gap-2.5" initial={false} animate={{ opacity: silenciado ? 0.55 : 1 }} transition={{ duration: 0.2 }}>
          <PuntoDeBuzon direccion={buzon.direccion} />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[14px] font-medium text-[var(--ls-t1)] lg:text-[13.5px]" title={buzon.direccion}>
                {direccionCorta(buzon.direccion)}
              </span>
              {buzon.asignado && <UserCheck className="h-3.5 w-3.5 shrink-0 text-[var(--viz-1)]" aria-label="Asignado a ti" />}
              {silenciado && <BellOff className="h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)]" aria-label="Silenciado" />}
            </span>
            <span className="block truncate text-[12px] text-[var(--ls-t3)]">
              {[dueno, cuenta ? `${cuenta} sin leer` : 'Al día', !buzon.puedeResponder ? 'solo lectura' : null].filter(Boolean).join(' · ')}
            </span>
          </span>
        </motion.span>
        {alerta && (
          <span title={alerta} className="inline-flex shrink-0 items-center gap-1 text-[11.5px] font-medium text-[var(--ls-e-ambar)]">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">{alerta}</span>
          </span>
        )}
      </button>
      <MenuDeSilencio
        silenciado={silenciado}
        hasta={hasta}
        que={`el buzón ${direccionCorta(buzon.direccion)}`}
        disabled={!disponible}
        onElegir={onSilencio}
        disparador={
          <button
            type="button"
            aria-label={silenciado ? `Silenciado: cambiar los avisos de ${buzon.direccion}` : `Avisos de ${buzon.direccion}: te avisa`}
            className={cn(
              'inline-flex h-11 shrink-0 items-center gap-0.5 rounded-[10px] px-2.5 transition-colors hover:bg-[var(--ls-sup3)] data-[state=open]:bg-[var(--ls-sup3)] disabled:cursor-not-allowed disabled:opacity-40 lg:h-9',
              silenciado ? 'text-[var(--ls-t3)]' : 'text-[var(--ls-t2)]',
              FOCO,
            )}
          >
            {silenciado ? <BellOff className="h-4 w-4" aria-hidden /> : <Bell className="h-4 w-4" aria-hidden />}
            <ChevronDown className="h-3 w-3 opacity-70" aria-hidden />
          </button>
        }
      />
    </li>
  )
}

function Seccion({ titulo, nota, children }: { titulo: string; nota?: string; children: ReactNode }) {
  return (
    <section className="mt-4 first:mt-0">
      <h3 className={ROTULO}>
        {titulo}
        {nota && <span className="ml-1.5 font-medium normal-case tracking-normal text-[var(--ls-t4)]">{nota}</span>}
      </h3>
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </section>
  )
}

/**
 * «SILENCIADOS»: los remitentes y las conversaciones que has silenciado tú, con «Reactivar». Se lee al abrir el panel y cada
 * «Reactivar» se guarda en el momento (no espera a «Guardar»): es deshacer algo que ya estaba hecho. Sin la 318, no sale.
 * Sale en dos sitios: al pie de «Elige tus correos» (lo abre cualquiera) y en Ajustes del buzón → «Silenciar» (spec 0: «Silenciados» en Ajustes).
 */
export function Silenciados({ abierto }: { abierto: boolean }) {
  const [datos, setDatos] = useState<DatosDeSilenciados | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reactivados, setReactivados] = useState<ReadonlySet<string>>(new Set())
  const [enCurso, setEnCurso] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    let vivo = true
    setCargando(true)
    setError(null)
    setReactivados(new Set())
    void pedir<DatosDeSilenciados>('/api/correo/preferencias').then((r) => {
      if (!vivo) return
      setCargando(false)
      if (r.ok) setDatos(r.datos)
      else setError(r.mensaje)
    })
    return () => {
      vivo = false
    }
  }, [abierto])

  if (datos && !datos.disponible) return null
  const lista = silenciadosParaPantalla(datos, reactivados)
  const ahora = Date.now()

  const reactivar = async (x: Silenciado) => {
    const id = `${x.tipo}:${x.clave}`
    if (enCurso) return
    setEnCurso(id)
    setError(null)
    const r =
      x.tipo === 'remitente'
        ? await enviarJson('/api/correo/preferencias', 'POST', { cambios: [{ remitente: x.clave, silencio: 'quitar' }] })
        : await enviarJson(`/api/correo/hilos/${encodeURIComponent(x.clave)}`, 'PATCH', { silenciado: 'quitar' })
    setEnCurso(null)
    // Si la conversación ya no existe o ya no se lee, tampoco hay nada que reactivar: se quita de la lista igual
    if (r.ok || (x.tipo === 'hilo' && r.estado === 404)) setReactivados((antes) => new Set(antes).add(id))
    else setError(r.mensaje)
  }

  return (
    <section className="mt-6 border-t border-[var(--ls-linea)] pt-4">
      <h3 className={ROTULO}>
        Silenciados
        <span className="ml-1.5 font-medium normal-case tracking-normal text-[var(--ls-t4)]">remitentes y conversaciones, solo para ti</span>
      </h3>
      {cargando && !datos ? (
        <p className="px-1 py-2 text-[12.5px] text-[var(--ls-t3)]">Cargando…</p>
      ) : lista.length === 0 ? (
        <p className="px-1 py-2 text-[12.5px] text-[var(--ls-t3)]">No tienes nada silenciado.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {lista.map((x) => {
            const id = `${x.tipo}:${x.clave}`
            const Icono = x.tipo === 'remitente' ? User : MessageSquare
            return (
              <li key={id} className="flex min-h-11 items-center gap-2.5 rounded-[10px] px-2 py-1.5 transition-colors hover:bg-[var(--ls-sup2)]">
                <Icono className="h-4 w-4 shrink-0 text-[var(--ls-t4)]" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-[var(--ls-t1)]" title={x.texto}>
                    {x.texto}
                  </span>
                  <span className="block truncate text-[12px] text-[var(--ls-t3)]">
                    {x.tipo === 'remitente' ? 'Remitente' : 'Conversación'} · {textoDeSilencio(true, x.hasta, ahora)}
                  </span>
                </span>
                <Boton
                  variante="fantasma"
                  tamano="sm"
                  icono={Bell}
                  cargando={enCurso === id}
                  disabled={enCurso !== null && enCurso !== id}
                  onClick={() => void reactivar(x)}
                  aria-label={`Reactivar ${x.tipo === 'remitente' ? 'el remitente' : 'la conversación'} ${x.texto}`}
                >
                  Reactivar
                </Boton>
              </li>
            )
          })}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-2 rounded-[10px] bg-[color-mix(in_srgb,var(--ls-e-rojo)_12%,transparent)] px-3 py-2 text-[12.5px] text-[var(--ls-e-rojo)]">
          {error}
        </p>
      )}
    </section>
  )
}

export function ElegirMisCorreos({ abierto, onCambio, buzones, disponible, onGuardar }: PropsDeElegirMisCorreos) {
  const [eleccion, setEleccion] = useState<Eleccion>({})
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // «Ahora» fijo mientras el panel está abierto: para el texto de los silencios recién elegidos
  const [ahora, setAhora] = useState(() => new Date())

  // Al abrir se parte de lo que hay; mientras está abierto, lo que llegue por el sondeo no pisa lo marcado
  useEffect(() => {
    if (!abierto) return
    setEleccion(eleccionInicial(buzones))
    setError(null)
    setGuardando(false)
    setAhora(new Date())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto])

  const { tuyos, asignados, equipo } = useMemo(() => seccionesDeEleccion(buzones), [buzones])
  const eleccionDe = (b: BuzonVisible): EleccionDeBuzon => eleccion[b.id] ?? { enMisCorreos: b.enMisCorreos }
  const cambios = useMemo(() => cambiosDeEleccion(buzones, { ...eleccionInicial(buzones), ...eleccion }), [buzones, eleccion])
  const cuantos = Object.values({ ...eleccionInicial(buzones), ...eleccion }).filter((e) => e.enMisCorreos).length

  const tocar = (id: string, parche: Partial<EleccionDeBuzon>, base: EleccionDeBuzon) => {
    setError(null)
    setEleccion((antes) => ({ ...antes, [id]: { ...(antes[id] ?? base), ...parche } }))
  }

  const guardar = async () => {
    if (!disponible || guardando) return
    if (cambios.length === 0) {
      onCambio(false)
      return
    }
    setGuardando(true)
    setError(null)
    try {
      await onGuardar(cambios)
      onCambio(false)
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'No se ha podido guardar. Prueba otra vez.')
    } finally {
      setGuardando(false)
    }
  }

  const fila = (b: BuzonVisible) => {
    const e = eleccionDe(b)
    return (
      <Fila
        key={b.id}
        buzon={b}
        eleccion={e}
        ahora={ahora}
        disponible={disponible}
        onMarcar={(v) => tocar(b.id, { enMisCorreos: v }, e)}
        onSilencio={(s) => tocar(b.id, { silencio: s }, e)}
      />
    )
  }

  return (
    <PanelLateralCorreo
      abierto={abierto}
      onCambio={(a) => {
        if (!a && guardando) return
        onCambio(a)
      }}
      cuantos={cuantos}
      pie={
        <>
          <Boton variante="secundario" onClick={() => onCambio(false)} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton variante="primario" onClick={guardar} cargando={guardando} disabled={!disponible}>
            {cambios.length > 0 ? `Guardar (${cambios.length})` : 'Guardar'}
          </Boton>
        </>
      }
    >
      {!disponible && (
        <div
          role="status"
          className="mb-4 flex items-start gap-2 rounded-[10px] border border-[color-mix(in_srgb,var(--ls-e-ambar)_30%,transparent)] bg-[color-mix(in_srgb,var(--ls-e-ambar)_10%,transparent)] px-3 py-2.5 text-[12.5px] leading-snug text-[var(--ls-e-ambar)]"
        >
          <AlertTriangle className="mt-[1px] h-4 w-4 shrink-0" aria-hidden />
          <span>Falta lanzar la migración 318 para elegir, asignar y silenciar correos. El resto de Correo funciona.</span>
        </div>
      )}

      {buzones.length === 0 ? (
        <p className="py-6 text-center text-[13.5px] text-[var(--ls-t3)]">Aún no puedes leer ningún buzón. Conecta el tuyo desde «Conectar buzón».</p>
      ) : (
        <>
          {tuyos.length > 0 && <Seccion titulo="Tuyos">{tuyos.map(fila)}</Seccion>}
          {asignados.length > 0 && <Seccion titulo="Asignados a ti">{asignados.map(fila)}</Seccion>}
          {equipo.length > 0 && (
            <Seccion titulo="Del equipo" nota="los que puedes leer">
              {equipo.map(fila)}
            </Seccion>
          )}
        </>
      )}

      {disponible && <Silenciados abierto={abierto} />}

      {error && (
        <p role="alert" className="mt-4 rounded-[10px] bg-[color-mix(in_srgb,var(--ls-e-rojo)_12%,transparent)] px-3 py-2 text-[12.5px] text-[var(--ls-e-rojo)]">
          {error}
        </p>
      )}
    </PanelLateralCorreo>
  )
}

/** El PanelLateral del kit con el título y la frase de esta pantalla */
function PanelLateralCorreo({
  abierto,
  onCambio,
  cuantos,
  pie,
  children,
}: {
  abierto: boolean
  onCambio: (a: boolean) => void
  cuantos: number
  pie: ReactNode
  children: ReactNode
}) {
  return (
    <PanelLateral
      abierto={abierto}
      onCambio={onCambio}
      titulo="Elige tus correos"
      descripcion={`Los que elijas salen arriba, se juntan en «Mis correos» y te avisan.${cuantos ? ` Ahora: ${cuantos}.` : ''}`}
      icono={Inbox}
      acento="marca"
      pie={pie}
    >
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </PanelLateral>
  )
}

export default ElegirMisCorreos
