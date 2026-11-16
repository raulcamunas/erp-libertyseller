'use client'

import { AlertCircle, BellOff, BellRing, CheckCircle2, ExternalLink, Eye, KeyRound, PenLine, Plug, Settings2, ShieldCheck, Unplug, Users } from 'lucide-react'
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Avatar, Boton, Confirmacion, EstadoVacio, EsqueletoTexto, Insignia, PanelDePestana, PanelLateral, Pestanas, type Opcion } from '@/components/ui-ls'
import { fechaCompleta, hace } from '@/lib/correo/fechas'
import type { CambioDePreferencia } from '@/lib/correo/preferencias'
import type { AccesoRegistrado, BuzonVisible, Duracion } from '@/lib/correo/tipos'
import { cn } from '@/lib/utils'
import { enviarJson, pedir } from './api'
import { Silenciados } from './ElegirMisCorreos'
import { DURACIONES, ETIQUETA_DE_DURACION, PuntoDeBuzon, textoDeSilencio } from './piezas'
import { CAMPO } from './ui'

/**
 * LOS AJUSTES DE UN BUZÓN (PanelLateral del kit, con pestañas). Spec «Correo Pro» 1.9 y flujo 19.
 * ================================================================================================
 *   General          estado, desde qué fecha se trae, y el nombre y la firma (solo los EDITA el dueño; los demás los ven)
 *   Conexión         cambiar la contraseña (el dueño) y desconectar (el dueño o un administrador), con Confirmacion
 *   Quién lo trabaja las personas con el buzón asignado (`buzon.asignaciones`), «responde» o «solo avisos». La ven el dueño y un admin;
 *                    solo el admin lo cambia, desde «Equipo y permisos» (aquí, el enlace)
 *   Rastro           «Quién ha mirado este buzón». SOLO un administrador (`verAccesos`): es el registro de auditoría de la empresa y no se le
 *                    enseña a la persona auditada; la ruta /api/correo/accesos tampoco le contesta. Incluye 'envio' y 'aviso' (migración 318)
 *   Silenciar        personal («para mí»): POST /api/correo/preferencias con { buzonId, silencio }. Debajo, «Silenciados»: los remitentes y
 *                    las conversaciones que ha silenciado quien mira (GET /api/correo/preferencias), cada uno con «Reactivar»
 *
 * Las llamadas son las de siempre: PATCH /api/correo/buzones/[id] (nombre, firma o contraseña), DELETE /api/correo/buzones/[id] (desconectar),
 * GET /api/correo/accesos?buzon= (rastro). La ruta lo vuelve a comprobar todo; `esMio` y `verAccesos` solo deciden qué se pinta.
 */

export type PestanaDeAjustes = 'general' | 'conexion' | 'trabajan' | 'rastro' | 'silenciar'

interface Props {
  buzon: BuzonVisible
  /** Es el dueño: edita nombre, firma y contraseña (configurar el buzón es SOLO del dueño, aunque otro lo tenga asignado con respuesta) */
  esMio: boolean
  /** Es un administrador: ve el rastro, ve quién lo trabaja y puede desconectar */
  verAccesos: boolean
  /** Un cambio que cierra los ajustes (guardar la firma, la contraseña, desconectar) con los buzones ya al día */
  onCambio: (buzones: BuzonVisible[]) => void
  onCerrar: () => void
  /**
   * OPCIONAL. Un cambio que NO cierra los ajustes (silenciar o quitar el silencio): los buzones al día para la barra. Sin él se llama a
   * onCambio (que en PanelCorreo, hoy, cierra el panel)
   */
  onBuzonesAlDia?: (buzones: BuzonVisible[]) => void
  /** OPCIONAL. El botón «Cambiarlo en Equipo y permisos» de «Quién lo trabaja» (solo admin). Sin él no sale */
  onEquipoYPermisos?: () => void
  /** OPCIONAL (por defecto true). false = falta la migración 318: «Silenciar» enseña la banda en vez de actuar */
  preferenciasDisponibles?: boolean
  /** OPCIONAL. La pestaña con la que se abre (por defecto «General»; si quien mira no la ve, «General») */
  pestanaInicial?: PestanaDeAjustes
  /** OPCIONAL (por defecto true). Para dejarlo montado y que se anime al cerrar */
  abierto?: boolean
}

/* ------------------------------------------------------------------ */
/* Lógica pura (con prueba en AjustesDeBuzon.prueba.ts)                */
/* ------------------------------------------------------------------ */

export const FALTA_LA_318_EN_AJUSTES = 'Falta lanzar la migración 318 para elegir, asignar y silenciar correos.'

/**
 * La frase de una fila del rastro, sin el nombre (que va delante, en negrita):
 *   envio    → envió “Re: presupuesto”            (sin asunto: «envió un correo»)
 *   aviso    → vio el aviso de “Re: presupuesto”  (sin asunto: «vio el aviso de un correo nuevo»)
 *   lista    → miró la lista de correos
 *   hilo     → abrió “asunto”                     (sin asunto: «abrió una conversación»)
 *   busqueda → buscó en el buzón
 *   adjunto  → descargó un adjunto de “asunto”    (sin asunto: «descargó un adjunto»)
 * Una acción que no se conoce (la columna es texto libre) sale como «miró el buzón», nunca vacía.
 */
export function fraseDeAcceso(a: { accion: AccesoRegistrado['accion'] | string; asunto: string | null }): string {
  const asunto = a.asunto?.trim() ? `“${a.asunto.trim()}”` : null
  switch (a.accion) {
    case 'envio':
      return asunto ? `envió ${asunto}` : 'envió un correo'
    case 'aviso':
      return asunto ? `vio el aviso de ${asunto}` : 'vio el aviso de un correo nuevo'
    case 'lista':
      return 'miró la lista de correos'
    case 'hilo':
      return asunto ? `abrió ${asunto}` : 'abrió una conversación'
    case 'busqueda':
      return 'buscó en el buzón'
    case 'adjunto':
      return asunto ? `descargó un adjunto de ${asunto}` : 'descargó un adjunto'
    default:
      return 'miró el buzón'
  }
}

/** Qué pestañas ve cada uno: General y Silenciar, todos; Conexión y Quién lo trabaja, el dueño y un admin; Rastro, solo un admin */
export function pestanasVisibles(p: { esMio: boolean; esAdmin: boolean }): PestanaDeAjustes[] {
  const v: PestanaDeAjustes[] = ['general']
  if (p.esMio || p.esAdmin) v.push('conexion', 'trabajan')
  if (p.esAdmin) v.push('rastro')
  v.push('silenciar')
  return v
}

export type EstadoDeConexion = 'bien' | 'aviso' | 'rechazada' | 'desconectado'

export function estadoDeBuzon(b: Pick<BuzonVisible, 'conectado' | 'credencialesInvalidas' | 'ultimoError'>): EstadoDeConexion {
  return !b.conectado ? 'desconectado' : b.credencialesInvalidas ? 'rechazada' : b.ultimoError ? 'aviso' : 'bien'
}

const TEXTO_DE_ESTADO: Record<EstadoDeConexion, string> = {
  bien: 'Conectado',
  aviso: 'Conectado, con un aviso',
  rechazada: 'El servidor ha rechazado la contraseña',
  desconectado: 'Desconectado',
}

const TONO_DE_ESTADO_DE_CONEXION = { bien: 'verde', aviso: 'ambar', rechazada: 'rojo', desconectado: 'gris' } as const

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

function Seccion({ titulo, icono: Icono, children }: { titulo: string; icono?: typeof Eye; children: ReactNode }) {
  return (
    <section aria-label={titulo} className="space-y-3 rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-4">
      <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-[var(--ls-t1)]">
        {Icono && <Icono className="h-4 w-4 text-[var(--ls-t3)]" aria-hidden />}
        {titulo}
      </h3>
      {children}
    </section>
  )
}

function Fallo({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-[10px] bg-[color-mix(in_srgb,var(--ls-e-ambar)_10%,transparent)] px-3 py-2 text-[13px] leading-snug text-[var(--ls-e-ambar)]" role="alert">
      <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden /> <span className="min-w-0">{children}</span>
    </p>
  )
}

function Nota({ children }: { children: ReactNode }) {
  return <p className="text-[12.5px] leading-relaxed text-[var(--ls-t3)]">{children}</p>
}

/** El textarea con el mismo aspecto que CAMPO (16 px en el móvil, para que Safari no amplíe) */
const AREA =
  'w-full resize-y rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3 text-base leading-relaxed text-[var(--ls-t1)] outline-none transition-[border-color,box-shadow] ' +
  'placeholder:text-[var(--ls-t4)] hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)] focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ls-acc-graf)_22%,transparent)] ' +
  'disabled:cursor-not-allowed disabled:opacity-60 lg:text-[13.5px]'

/* ------------------------------------------------------------------ */
/* El panel                                                            */
/* ------------------------------------------------------------------ */

export function AjustesDeBuzon({
  buzon,
  esMio,
  verAccesos,
  onCambio,
  onCerrar,
  onBuzonesAlDia,
  onEquipoYPermisos,
  preferenciasDisponibles = true,
  pestanaInicial = 'general',
  abierto = true,
}: Props) {
  const esAdmin = verAccesos
  const visibles = useMemo(() => pestanasVisibles({ esMio, esAdmin }), [esMio, esAdmin])
  const [pestana, setPestana] = useState<PestanaDeAjustes>(visibles.includes(pestanaInicial) ? pestanaInicial : 'general')
  const idPanel = useId()

  const [nombre, setNombre] = useState(buzon.nombre ?? '')
  const [firma, setFirma] = useState(buzon.firma ?? '')
  const [password, setPassword] = useState('')
  const [guardando, setGuardando] = useState<null | 'firma' | 'contrasena' | 'silencio'>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmaDesconectar, setConfirmaDesconectar] = useState(false)
  const [accesos, setAccesos] = useState<AccesoRegistrado[] | null>(null)
  const [errorAccesos, setErrorAccesos] = useState<string | null>(null)
  // El silencio se pinta con lo último que contestó la ruta (por si el padre tarda en pasar el buzón nuevo)
  const [silencio, setSilencio] = useState({ silenciado: buzon.silenciado, hasta: buzon.silenciadoHasta })
  useEffect(() => setSilencio({ silenciado: buzon.silenciado, hasta: buzon.silenciadoHasta }), [buzon.silenciado, buzon.silenciadoHasta])

  // El rastro se pide solo si es administrador, y al abrir su pestaña (a quien no lo es, la ruta le diría «no existe»: ni se intenta)
  useEffect(() => {
    if (!verAccesos || pestana !== 'rastro' || accesos !== null || errorAccesos !== null) return
    let vivo = true
    void pedir<{ accesos: AccesoRegistrado[] }>(`/api/correo/accesos?buzon=${encodeURIComponent(buzon.id)}`).then((r) => {
      if (!vivo) return
      if (r.ok) setAccesos(r.datos.accesos ?? [])
      else setErrorAccesos(r.mensaje)
    })
    return () => {
      vivo = false
    }
  }, [buzon.id, verAccesos, pestana, accesos, errorAccesos])

  const cambiarPestana = (p: PestanaDeAjustes) => {
    setPestana(p)
    setError(null)
  }

  async function guardarFirma() {
    setGuardando('firma')
    setError(null)
    const r = await enviarJson<{ buzones: BuzonVisible[] }>(`/api/correo/buzones/${buzon.id}`, 'PATCH', { nombre, firma })
    setGuardando(null)
    if (!r.ok) return setError(r.mensaje)
    toast.success('Guardado.')
    onCambio(r.datos.buzones)
  }

  async function cambiarContrasena() {
    if (!password) return
    const escrita = password
    // La contraseña no se queda en el estado más de lo necesario: se suelta en cuanto se toma
    setPassword('')
    setGuardando('contrasena')
    setError(null)
    const r = await enviarJson<{ buzones: BuzonVisible[] }>(`/api/correo/buzones/${buzon.id}`, 'PATCH', { password: escrita })
    setGuardando(null)
    if (!r.ok) return setError(r.mensaje)
    toast.success('Contraseña guardada. Vuelves a recibir correos.')
    onCambio(r.datos.buzones)
  }

  /** La llama Confirmacion: si lanza, el diálogo se queda abierto (el error sale en un toast y en la pestaña) */
  async function desconectar() {
    setError(null)
    const r = await enviarJson<{ buzones: BuzonVisible[] }>(`/api/correo/buzones/${buzon.id}`, 'DELETE')
    if (!r.ok) {
      setError(r.mensaje)
      toast.error(r.mensaje)
      throw new Error(r.mensaje)
    }
    toast.success('Buzón desconectado. Lo ya importado se queda.')
    onCambio(r.datos.buzones)
  }

  async function silenciar(eleccion: Duracion | 'quitar') {
    if (!preferenciasDisponibles) return setError(FALTA_LA_318_EN_AJUSTES)
    setGuardando('silencio')
    setError(null)
    const cambios: CambioDePreferencia[] = [{ buzonId: buzon.id, silencio: eleccion }]
    const r = await enviarJson<{ buzones: BuzonVisible[] }>('/api/correo/preferencias', 'POST', { cambios })
    setGuardando(null)
    if (!r.ok) return setError(r.estado === 503 ? FALTA_LA_318_EN_AJUSTES : r.mensaje)
    const buzones = r.datos.buzones ?? []
    const nuevo = buzones.find((b) => b.id === buzon.id)
    if (nuevo) setSilencio({ silenciado: nuevo.silenciado, hasta: nuevo.silenciadoHasta })
    toast.success(eleccion === 'quitar' ? 'Vuelve a avisarte.' : 'Silenciado. No te avisa ni suma en el número.')
    ;(onBuzonesAlDia ?? onCambio)(buzones)
  }

  const estado = estadoDeBuzon(buzon)
  const OPCION_DE_PESTANA: Record<PestanaDeAjustes, Opcion<PestanaDeAjustes>> = {
    general: { id: 'general', texto: 'General', icono: Settings2 },
    conexion: { id: 'conexion', texto: 'Conexión', icono: Plug },
    trabajan: { id: 'trabajan', texto: 'Quién lo trabaja', icono: Users, cuenta: buzon.asignaciones.length || undefined },
    rastro: { id: 'rastro', texto: 'Rastro', icono: Eye },
    silenciar: { id: 'silenciar', texto: 'Silenciar', icono: silencio.silenciado ? BellOff : BellRing },
  }
  const opciones = visibles.map((v) => OPCION_DE_PESTANA[v])
  const cambiada = nombre !== (buzon.nombre ?? '') || firma !== (buzon.firma ?? '')
  const dueno = buzon.propietario.nombre

  return (
    <>
      <PanelLateral
        abierto={abierto}
        onCambio={(a) => !a && onCerrar()}
        titulo="Ajustes del buzón"
        descripcion={
          <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
            <PuntoDeBuzon direccion={buzon.direccion} />
            <span className="truncate">{buzon.direccion}</span>
          </span>
        }
        icono={Settings2}
        acento="marca"
        ancho={520}
        acciones={
          silencio.silenciado ? (
            <Insignia tono="gris" icono={BellOff} tamano="sm" className="mt-1 hidden sm:inline-flex">
              Silenciado
            </Insignia>
          ) : undefined
        }
      >
        <div className="-mx-5 -mt-4 mb-4 px-3 pt-1">
          <Pestanas etiqueta="Secciones de los ajustes" opciones={opciones} valor={pestana} onCambio={cambiarPestana} acento="marca" idPanel={idPanel} />
        </div>

        <PanelDePestana id={idPanel} key={pestana} className="space-y-4">
          {error && <Fallo>{error}</Fallo>}

          {pestana === 'general' && (
            <>
              <Seccion titulo="Estado" icono={estado === 'bien' ? CheckCircle2 : AlertCircle}>
                <div className="flex flex-wrap items-center gap-2">
                  <Insignia tono={TONO_DE_ESTADO_DE_CONEXION[estado]}>{TEXTO_DE_ESTADO[estado]}</Insignia>
                  {!buzon.historicoCompleto && buzon.conectado && (
                    <Insignia tono="cian" vivo>
                      Trayendo correos antiguos
                    </Insignia>
                  )}
                </div>
                <Nota>
                  <span suppressHydrationWarning>{buzon.ultimoSyncAt ? `Última lectura ${hace(buzon.ultimoSyncAt)}.` : 'Todavía no se ha leído nada.'}</span> Trae los correos desde el{' '}
                  {new Date(buzon.desdeFecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' })}.
                </Nota>
                {buzon.ultimoError && <p className="break-words text-[12.5px] leading-snug text-[var(--ls-e-ambar)]">{buzon.ultimoError}</p>}
                {!esMio && (
                  <p className="text-[12.5px] text-[var(--ls-t3)]">
                    Es el buzón de <span className="font-medium text-[var(--ls-t1)]">{dueno}</span>.
                  </p>
                )}
              </Seccion>

              <Seccion titulo={esMio ? 'Cómo firmas' : 'Cómo firma'} icono={PenLine}>
                <label className="block space-y-1.5">
                  <span className="text-[12.5px] font-medium text-[var(--ls-t2)]">{esMio ? 'Tu nombre al enviar' : 'Nombre al enviar'}</span>
                  <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} disabled={!esMio} className={cn(CAMPO, 'bg-[var(--ls-sup)]')} />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[12.5px] font-medium text-[var(--ls-t2)]">Firma</span>
                  <textarea
                    value={firma}
                    onChange={(e) => setFirma(e.target.value)}
                    rows={5}
                    maxLength={2000}
                    disabled={!esMio}
                    placeholder={esMio ? 'Sale ya escrita al redactar' : 'Sin firma'}
                    className={AREA}
                  />
                </label>
                {esMio ? (
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <Nota>Sale ya escrita al redactar; la puedes cambiar en cada mensaje.</Nota>
                    <Boton variante="primario" onClick={guardarFirma} cargando={guardando === 'firma'} disabled={guardando !== null || !nombre.trim() || !cambiada}>
                      Guardar
                    </Boton>
                  </div>
                ) : (
                  <Nota>Solo {dueno} cambia su nombre y su firma. Quien tiene el buzón asignado firma con esta.</Nota>
                )}
              </Seccion>
            </>
          )}

          {pestana === 'conexion' && (
            <>
              {esMio && (
                <Seccion titulo={buzon.conectado ? 'Cambiar la contraseña' : 'Volver a conectar'} icono={KeyRound}>
                  {buzon.credencialesInvalidas && <Fallo>El servidor ha rechazado la contraseña guardada. Pon la nueva para volver a recibir correos.</Fallo>}
                  <form
                    className="flex flex-col gap-2 sm:flex-row"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void cambiarContrasena()
                    }}
                  >
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      spellCheck={false}
                      autoCapitalize="off"
                      autoCorrect="off"
                      data-1p-ignore
                      data-lpignore="true"
                      data-bwignore="true"
                      placeholder="Contraseña del buzón"
                      aria-label="Contraseña del buzón"
                      disabled={guardando !== null}
                      className={cn(CAMPO, 'bg-[var(--ls-sup)]')}
                    />
                    <Boton type="submit" variante="primario" cargando={guardando === 'contrasena'} disabled={guardando !== null || !password}>
                      {guardando === 'contrasena' ? 'Comprobando…' : 'Guardar'}
                    </Boton>
                  </form>
                  <Nota>Es la del buzón (la del webmail de Hostinger). Se comprueba contra el servidor antes de guardarla y no se vuelve a mostrar.</Nota>
                </Seccion>
              )}

              {buzon.conectado ? (
                <Seccion titulo="Desconectar" icono={Unplug}>
                  <Nota>Se borra la contraseña y dejan de llegar correos nuevos y de poder enviarse. Los correos ya importados se quedan en el ERP.</Nota>
                  <Boton variante="peligro" icono={Unplug} onClick={() => setConfirmaDesconectar(true)} className="w-full sm:w-auto">
                    Desconectar este buzón
                  </Boton>
                </Seccion>
              ) : (
                !esMio && <EstadoVacio compacto icono={Unplug} titulo="Está desconectado" descripcion={`Solo ${dueno} puede volver a conectarlo con su contraseña.`} />
              )}
            </>
          )}

          {pestana === 'trabajan' && (
            <Seccion titulo="Quién lo trabaja" icono={Users}>
              {buzon.asignaciones.length === 0 ? (
                <Nota>
                  Nadie más lo tiene asignado.{' '}
                  {esAdmin ? 'Asígnalo para que otra persona lo lea, le avise y, si quieres, conteste desde él.' : 'Lo asigna un administrador.'}
                </Nota>
              ) : (
                <ul className="divide-y divide-[var(--ls-linea)] overflow-hidden rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
                  {buzon.asignaciones.map((a) => (
                    <li key={a.personaId} className="flex min-h-[52px] items-center gap-3 px-3 py-2">
                      <Avatar nombre={a.nombre} tamano={32} />
                      <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[var(--ls-t1)] lg:text-[13.5px]">{a.nombre}</span>
                      {a.puedeResponder ? (
                        <Insignia tono="azul" icono={PenLine} tamano="sm" title="Lo lee, le avisa y puede responder y enviar desde el buzón">
                          responde
                        </Insignia>
                      ) : (
                        <Insignia tono="gris" icono={Eye} tamano="sm" title="Lo lee y le avisa, pero no envía desde él">
                          solo avisos
                        </Insignia>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <Nota>Lo que lee y envía quien lo tiene asignado queda anotado, y cada correo guarda quién lo envió.</Nota>
              {esAdmin && onEquipoYPermisos && (
                <Boton variante="secundario" iconoDerecha={ExternalLink} onClick={onEquipoYPermisos} className="w-full sm:w-auto">
                  Cambiarlo en Equipo y permisos
                </Boton>
              )}
              {!esAdmin && <Nota>Solo un administrador cambia quién lo trabaja.</Nota>}
            </Seccion>
          )}

          {pestana === 'rastro' && verAccesos && (
            <Seccion titulo={`Quién ha mirado ${esMio ? 'tu buzón' : 'este buzón'}`} icono={ShieldCheck}>
              {errorAccesos ? (
                <Fallo>{errorAccesos}</Fallo>
              ) : accesos === null ? (
                <div role="status" aria-label="Cargando el rastro">
                  <EsqueletoTexto lineas={4} />
                </div>
              ) : accesos.length === 0 ? (
                <EstadoVacio compacto icono={Eye} titulo="Nadie lo ha mirado" descripcion="Desde que se conectó, nadie más que su dueño ha abierto este buzón." />
              ) : (
                <ul className="divide-y divide-[var(--ls-linea)] overflow-hidden rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
                  {accesos.map((a) => (
                    <li key={a.id} className="flex items-start gap-3 px-3 py-2.5">
                      <Avatar nombre={a.quien} tamano={28} className="mt-0.5" />
                      <div className="min-w-0 flex-1 text-[13px] leading-snug text-[var(--ls-t2)]">
                        <span className="font-medium text-[var(--ls-t1)]">{a.quien}</span> <span className="break-words">{fraseDeAcceso(a)}</span>
                        <span className="mt-0.5 block text-[12px] tabular-nums text-[var(--ls-t4)]" suppressHydrationWarning>
                          {fechaCompleta(a.cuando)} · {hace(a.cuando)}
                        </span>
                      </div>
                      {a.accion === 'envio' && (
                        <Insignia tono="azul" tamano="sm" className="mt-0.5">
                          envío
                        </Insignia>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <Nota>
                Se anota cuando alguien que no es el dueño abre una lista, una conversación, una búsqueda o un adjunto, ve el aviso de un correo nuevo o envía desde el buzón. Varias
                miradas seguidas a lo mismo cuentan como una; cada envío, uno.
              </Nota>
            </Seccion>
          )}

          {pestana === 'silenciar' && (
            <>
              <Seccion titulo="Silenciar, solo para mí" icono={BellOff}>
                {!preferenciasDisponibles && <Fallo>{FALTA_LA_318_EN_AJUSTES}</Fallo>}
                <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-2.5">
                  {silencio.silenciado ? <BellOff className="h-5 w-5 shrink-0 text-[var(--ls-t3)]" aria-hidden /> : <BellRing className="h-5 w-5 shrink-0 text-[var(--ls-acc)]" aria-hidden />}
                  <p className="min-w-0 flex-1 text-[13.5px] font-medium text-[var(--ls-t1)]" aria-live="polite" suppressHydrationWarning>
                    {silencio.silenciado ? textoDeSilencio(true, silencio.hasta) : 'Te avisa de lo nuevo'}
                  </p>
                  {silencio.silenciado && (
                    <Boton variante="secundario" tamano="sm" icono={BellRing} onClick={() => void silenciar('quitar')} cargando={guardando === 'silencio'} disabled={guardando !== null || !preferenciasDisponibles}>
                      Quitar silencio
                    </Boton>
                  )}
                </div>
                <div role="group" aria-label="Silenciar durante" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {DURACIONES.map((d) => (
                    <Boton key={d} variante="secundario" icono={BellOff} onClick={() => void silenciar(d)} disabled={guardando !== null || !preferenciasDisponibles} className="justify-start bg-[var(--ls-sup)]">
                      {ETIQUETA_DE_DURACION[d]}
                    </Boton>
                  ))}
                </div>
                <Nota>
                  Lo silenciado no te avisa (ni abajo a la derecha, ni en la campana, ni con sonido) y no suma en el número del menú. Sigue a la vista, atenuado, y solo te afecta a ti.
                  Los rebotes te avisan siempre.
                </Nota>
              </Seccion>
              {preferenciasDisponibles && <Silenciados abierto={abierto} />}
            </>
          )}
        </PanelDePestana>
      </PanelLateral>

      <Confirmacion
        abierto={confirmaDesconectar}
        onCambio={setConfirmaDesconectar}
        titulo="¿Desconectar este buzón?"
        descripcion={`Se borra la contraseña de ${buzon.direccion}: dejan de llegar correos nuevos y de poder enviarse. Lo ya importado se queda en el ERP. ${
          esMio ? 'Puedes volver a conectarlo con tu contraseña.' : `Solo ${dueno} podrá volver a conectarlo.`
        }`}
        palabra={null}
        textoConfirmar="Sí, desconectar"
        tono="peligro"
        onConfirmar={desconectar}
      />
    </>
  )
}
