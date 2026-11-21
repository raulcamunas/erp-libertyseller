'use client'

import * as Menu from '@radix-ui/react-dropdown-menu'
import { motion, useReducedMotion } from 'framer-motion'
import {
  ArrowLeft,
  BellOff,
  BellRing,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  Forward,
  ImageOff,
  Link2,
  MailOpen,
  MailWarning,
  Moon,
  MoreHorizontal,
  Paperclip,
  Reply,
  ReplyAll,
  Send,
  Star,
  Sun,
  UserCheck,
  UserPlus,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Avatar, Boton, Esqueleto, EstadoVacio, Insignia, TACTIL } from '@/components/ui-ls'
import { nombreOCorreo, type Persona } from '@/lib/correo/direcciones'
import { fechaCompleta, fechaDeLista, hace } from '@/lib/correo/fechas'
import { tamanoLegible } from '@/lib/correo/formato'
import { tieneDisenoPropio, type FondoDeCorreo } from '@/lib/correo/html'
import { direccionCorta } from '@/lib/correo/marcas'
import type { ModoDeRedactar } from '@/lib/correo/redactar'
import type { BuzonVisible, Duracion, HiloAbierto, MensajeDeHilo } from '@/lib/correo/tipos'
import { cn } from '@/lib/utils'
import type { PropsDeVistaDeHilo } from './contratos'
import { CuerpoDeCorreo } from './CuerpoDeCorreo'
import { AvatarDeRemitente, DURACIONES, ETIQUETA_DE_DURACION, InsigniaSilenciado, Kbd, MenuDeSilencio, PuntoDeBuzon } from './piezas'
import { RespuestaRapida } from './RespuestaRapida'
import { useTemaOscuro } from './tema'
import { BOTON_ICONO, Etiqueta } from './ui'

/**
 * UN HILO ABIERTO (columna 3 en escritorio; nivel «Hilo» en el móvil).
 *
 *   · Cabecera: asunto, la insignia del buzón (punto y dirección), el número de mensajes y las acciones: ★, silenciar la conversación, encargarla
 *     (UserPlus, o el avatar de quien la lleva) y ⋯ (Marcar no leído, que YA NO cierra el hilo; Silenciar a este remitente; Copiar enlace).
 *     En el móvil es pegajosa y deja sitio a la hamburguesa (`pl-14`); ★ y «Encargar» pasan al ⋯ para que quepa el asunto.
 *   · «Solo lectura · queda anotado» si se está supervisando, y «Asignado a ti · lo que lees y envías queda anotado» si el buzón está asignado.
 *   · Franja «Lo lleva X · desde …» con [Hecho] (si es tuya, o si puedes responder) y [Cambiar].
 *   · Tarjetas: los viejos y leídos plegados en una línea; el último y los no leídos, abiertos. Los salientes que mandó otra persona del equipo
 *     llevan «Enviado por X». El cuerpo va en un marco aislado (CuerpoDeCorreo) con las imágenes de fuera bloqueadas hasta que se pidan, y el
 *     sol/luna para cambiar el fondo de ese mensaje.
 *   · Escribir (responder, a todos, reenviar, destacar, marcar, encargar) depende SOLO de `puedeResponder`. `esMio` llega por compatibilidad y no
 *     se usa para decidir nada aquí.
 *   · Desde md, «Responder rápido» fijo al pie. En el móvil NO hay respuesta en línea: una barra pegajosa abajo, solo con botones a la
 *     izquierda (deja 72 px a la derecha para la pastilla del chat y los avisos), y «Responder» abre la hoja de Redactar.
 *
 * Diseño de altura: desde md la vista llena su columna y desplaza por dentro; en el móvil la página desplaza entera (por eso los `sticky`).
 */

/* ------------------------------------------------------------------ */
/* Lógica pura (con prueba en hilo.prueba.ts)                          */
/* ------------------------------------------------------------------ */

/** El mensaje al que se contesta por defecto: el último entrante; si no hay ninguno, el último */
export function mensajeAlQueContestar(mensajes: readonly MensajeDeHilo[]): MensajeDeHilo | null {
  for (let i = mensajes.length - 1; i >= 0; i--) if (mensajes[i].direccion === 'entrante') return mensajes[i]
  return mensajes[mensajes.length - 1] ?? null
}

/** Abiertos al empezar: el último y todo lo que esté sin leer */
export function abiertosAlEmpezar(mensajes: readonly MensajeDeHilo[]): Set<string> {
  const ids = new Set<string>(mensajes.filter((m) => !m.leido).map((m) => m.id))
  const ultimo = mensajes[mensajes.length - 1]
  if (ultimo) ids.add(ultimo.id)
  return ids
}

/** El remitente de la conversación (para «Silenciar a este remitente»): quien escribe del otro lado en el último entrante */
export function remitenteDelHilo(mensajes: readonly MensajeDeHilo[]): { direccion: string; nombre: string } | null {
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const m = mensajes[i]
    const direccion = (m.deDireccion ?? '').trim().toLowerCase()
    if (m.direccion === 'entrante' && direccion.includes('@')) return { direccion, nombre: m.deNombre?.trim() || direccion }
  }
  return null
}

/** Cómo lee quien mira este buzón: el suyo, asignado por un administrador, o supervisando. null mientras no se sabe */
export function accesoDelBuzon(buzon: Pick<BuzonVisible, 'esMio' | 'asignado'> | null): 'propio' | 'asignado' | 'supervision' | null {
  if (!buzon) return null
  if (buzon.esMio) return 'propio'
  return buzon.asignado ? 'asignado' : 'supervision'
}

/** El enlace que abre este hilo en Correo (?buzon=&hilo=, lo que lee la app al montar) */
export function enlaceDelHilo(base: string, buzonId: string, hiloId: string): string {
  const u = new URL(base)
  u.searchParams.set('buzon', buzonId)
  u.searchParams.set('hilo', hiloId)
  return u.toString()
}

/** «Enviado por …» de un saliente: solo cuando lo mandó otra persona que no es el dueño (el servidor solo lo manda entonces) */
export function etiquetaDeEnviadoPor(enviadoPor: MensajeDeHilo['enviadoPor'], yoId: string): string | null {
  if (!enviadoPor || !enviadoPor.nombre?.trim()) return null
  return enviadoPor.id && enviadoPor.id === yoId ? 'Enviado por ti' : `Enviado por ${enviadoPor.nombre.trim().split(/\s+/)[0]}`
}

/** «desde ayer», «desde hace 3 h»… para la franja de la encargada */
export function desdeCuando(iso: string, ahora: number = Date.now()): string {
  const h = hace(iso, ahora)
  if (!h) return ''
  return h === 'ahora mismo' ? 'desde hace un momento' : `desde ${h}`
}

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

const HAY_IMAGENES_DE_FUERA = /<img\b[^>]*\bsrc\s*=\s*["']?https?:/i
const HAY_FONDOS_DE_FUERA = /url\(\s*["']?https?:/i

const OPCION =
  'flex min-h-11 cursor-pointer select-none items-center gap-2.5 rounded-[8px] px-2.5 text-[14px] text-[var(--ls-t1)] outline-none ' +
  'data-[highlighted]:bg-[var(--ls-sup3)] data-[disabled]:pointer-events-none data-[disabled]:opacity-40 lg:min-h-9 lg:text-[13px]'
const CONTENIDO_DE_MENU =
  'z-[80] w-[min(calc(100vw-32px),260px)] rounded-[14px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-1.5 shadow-[var(--ls-sombra-3)] ' +
  'motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:zoom-in-95'

function destinatarios(personas: Persona[], maximo = 3): string {
  if (personas.length === 0) return ''
  const primeros = personas.slice(0, maximo).map(nombreOCorreo).join(', ')
  return personas.length > maximo ? `${primeros} y ${personas.length - maximo} más` : primeros
}

/**
 * Quién firma un mensaje en la tarjeta. Un saliente con `enviadoPor` lo firma quien lo escribió de verdad: «Tú» si fuiste tú, y si no su nombre de
 * pila (aunque el buzón sea tuyo: lo mandó la persona que lo tiene asignado). Sin `enviadoPor` (los de antes, o los enviados fuera del ERP), un saliente
 * de tu buzón es «Tú» y el resto, el remitente.
 */
export function autorDe(m: MensajeDeHilo, buzon: Pick<BuzonVisible, 'esMio'> | null, yoId: string): string {
  if (m.direccion === 'saliente') {
    const nombre = m.enviadoPor?.nombre?.trim()
    if (nombre) return m.enviadoPor?.id && m.enviadoPor.id === yoId ? 'Tú' : nombre.split(/\s+/)[0]
    if (buzon?.esMio) return 'Tú'
  }
  return m.deNombre || (m.direccion === 'saliente' ? direccionCorta(m.deDireccion) : m.deDireccion) || '(sin remitente)'
}

const esRebote = (m: MensajeDeHilo) => /mailer-daemon|postmaster/i.test(m.deDireccion ?? '')

interface PropsDeTarjeta {
  mensaje: MensajeDeHilo
  abierto: boolean
  puedeResponder: boolean
  temaOscuro: boolean
  buzon: BuzonVisible | null
  yoId: string
  onAlternar: () => void
  onResponder: (modo: ModoDeRedactar, m: MensajeDeHilo) => void
}

function Tarjeta({ mensaje, abierto, puedeResponder, temaOscuro, buzon, yoId, onAlternar, onResponder }: PropsDeTarjeta) {
  const [imagenes, setImagenes] = useState(false)
  // El fondo en que se enseña: oscuro si el ERP lo es y el correo no trae diseño propio (ni imágenes); si no, gris claro. Se puede cambiar a mano
  const [forzado, setForzado] = useState<FondoDeCorreo | null>(null)
  const conDiseno = useMemo(() => !!mensaje.html && tieneDisenoPropio(mensaje.html), [mensaje.html])
  const fondo: FondoDeCorreo = forzado ?? (temaOscuro && !conDiseno ? 'oscuro' : 'claro')
  const quien = autorDe(mensaje, buzon, yoId)
  const hayImagenesBloqueadas = useMemo(() => !!mensaje.html && (HAY_IMAGENES_DE_FUERA.test(mensaje.html) || HAY_FONDOS_DE_FUERA.test(mensaje.html)), [mensaje.html])
  const varios = mensaje.para.length + mensaje.cc.length > 1
  const enviadoPor = mensaje.direccion === 'saliente' ? etiquetaDeEnviadoPor(mensaje.enviadoPor, yoId) : null
  const rebote = mensaje.direccion === 'entrante' && esRebote(mensaje)

  if (!abierto) {
    const trozo = mensaje.texto.replace(/\s+/g, ' ').trim().slice(0, 140)
    return (
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={false}
        className={cn(
          'flex min-h-11 w-full items-center gap-2.5 rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-2 text-left transition-colors hover:bg-[var(--ls-sup2)]',
          'outline-none focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)]',
        )}
      >
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)]" aria-hidden />
        <AvatarDeRemitente nombre={mensaje.deNombre} direccion={mensaje.deDireccion} automatico={mensaje.automatico} rebote={rebote} tamano={24} />
        <span className="w-24 shrink-0 truncate text-[13px] font-medium text-[var(--ls-t2)] sm:w-36">{quien}</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--ls-t3)]">{trozo}</span>
        {mensaje.adjuntos.length > 0 && <Paperclip className="h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)]" aria-label="Con adjuntos" />}
        <time dateTime={mensaje.fecha} title={fechaCompleta(mensaje.fecha)} className="shrink-0 text-[12px] tabular-nums text-[var(--ls-t4)]">
          {fechaDeLista(mensaje.fecha)}
        </time>
      </button>
    )
  }

  return (
    <article className={cn('overflow-hidden rounded-[14px] border bg-[var(--ls-sup)] shadow-[var(--ls-sombra-1)]', mensaje.leido ? 'border-[var(--ls-linea)]' : 'border-[var(--ls-acc-graf)]')}>
      <header className="flex items-start gap-3 px-3 py-3 lg:px-4">
        <AvatarDeRemitente nombre={mensaje.deNombre} direccion={mensaje.deDireccion} automatico={mensaje.automatico} rebote={rebote} tamano={34} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[var(--ls-t1)]">
              {quien}
              {mensaje.deNombre && quien !== 'Tú' && <span className="ml-1.5 hidden text-[12px] font-normal text-[var(--ls-t4)] sm:inline">&lt;{mensaje.deDireccion}&gt;</span>}
            </p>
            <time dateTime={mensaje.fecha} title={fechaCompleta(mensaje.fecha)} className="mt-0.5 shrink-0 text-[12px] tabular-nums text-[var(--ls-t4)]">
              <span className="sm:hidden">{fechaDeLista(mensaje.fecha)}</span>
              <span className="hidden sm:inline">{fechaCompleta(mensaje.fecha)}</span>
            </time>
            {temaOscuro && (
              <button
                type="button"
                onClick={() => setForzado(fondo === 'oscuro' ? 'claro' : 'oscuro')}
                className={cn(BOTON_ICONO, '-my-2 h-9 w-9 lg:-my-1 lg:h-7 lg:w-7')}
                title={fondo === 'oscuro' ? 'Ver este correo sobre fondo claro' : 'Ver este correo sobre fondo oscuro'}
                aria-label={fondo === 'oscuro' ? 'Ver este correo sobre fondo claro' : 'Ver este correo sobre fondo oscuro'}
              >
                {fondo === 'oscuro' ? <Sun className="h-3.5 w-3.5" aria-hidden /> : <Moon className="h-3.5 w-3.5" aria-hidden />}
              </button>
            )}
            <button type="button" onClick={onAlternar} aria-label="Plegar el mensaje" aria-expanded className={cn(BOTON_ICONO, '-my-2 -mr-1 h-9 w-9 lg:-my-1 lg:h-7 lg:w-7')}>
              <ChevronDown className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--ls-t4)]">
            <span className="min-w-0 truncate" title={[...mensaje.para, ...mensaje.cc].map((p) => p.direccion).join(', ')}>
              para {destinatarios(mensaje.para) || '—'}
              {mensaje.cc.length > 0 && <> · cc {destinatarios(mensaje.cc)}</>}
            </span>
            {enviadoPor && (
              <Insignia tono="azul" icono={Send} tamano="sm" title="Salió desde este buzón, pero lo escribió otra persona del equipo (queda anotado)">
                {enviadoPor}
              </Insignia>
            )}
            {mensaje.automatico && <Etiqueta>Automático</Etiqueta>}
            {!mensaje.leido && <Etiqueta tono="acento">Nuevo</Etiqueta>}
          </p>
        </div>
      </header>

      {hayImagenesBloqueadas && !imagenes && (
        <p className="mx-3 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] bg-[var(--ls-sup2)] px-3 py-2 text-[12px] text-[var(--ls-t3)] lg:mx-4">
          <span className="flex items-center gap-1.5">
            <ImageOff className="h-3.5 w-3.5 shrink-0" aria-hidden /> Las imágenes de fuera están bloqueadas: quien lo envía sabría que lo has abierto.
          </span>
          <button type="button" onClick={() => setImagenes(true)} className={cn('font-medium text-[var(--ls-acc)] underline underline-offset-2 hover:brightness-110', TACTIL)}>
            Mostrar imágenes
          </button>
        </p>
      )}

      <div className="px-3 pb-3 lg:px-4">
        <CuerpoDeCorreo html={mensaje.html} texto={mensaje.texto} imagenesDeFuera={imagenes} fondo={fondo} />
      </div>

      {mensaje.adjuntos.length > 0 && (
        <ul className="flex flex-wrap gap-2 border-t border-[var(--ls-linea)] px-3 py-2.5 lg:px-4" aria-label="Adjuntos">
          {mensaje.adjuntos.map((a) => (
            <li key={a.n} className="min-w-0 max-w-full">
              <a
                href={`/api/correo/adjuntos?mensaje=${encodeURIComponent(mensaje.id)}&n=${a.n}`}
                download={a.nombre}
                className={cn(
                  'inline-flex min-h-11 max-w-full items-center gap-2 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-1.5 text-[12.5px] text-[var(--ls-t2)] transition-colors hover:border-[var(--ls-linea2)] hover:text-[var(--ls-t1)] sm:max-w-[280px] lg:min-h-9',
                  'outline-none focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)]',
                )}
              >
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)]" aria-hidden />
                <span className="min-w-0 truncate">{a.nombre}</span>
                <span className="shrink-0 text-[11px] text-[var(--ls-t4)]">{tamanoLegible(a.tamano)}</span>
                <Download className="h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)]" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      )}

      {/* En el móvil estas acciones van en la barra de abajo */}
      {puedeResponder && (
        <div className="hidden flex-wrap gap-1.5 border-t border-[var(--ls-linea)] px-3 py-2 md:flex lg:px-4">
          <Boton tamano="sm" icono={Reply} onClick={() => onResponder('responder', mensaje)} title="Responder (r)">
            Responder
          </Boton>
          {varios && (
            <Boton tamano="sm" icono={ReplyAll} onClick={() => onResponder('responder-todos', mensaje)} title="Responder a todos (a)">
              Responder a todos
            </Boton>
          )}
          <Boton tamano="sm" icono={Forward} onClick={() => onResponder('reenviar', mensaje)} title="Reenviar (f)">
            Reenviar
          </Boton>
        </div>
      )}
    </article>
  )
}

function Mensajes({ hilo, puedeResponder, buzon, yoId, onResponder }: { hilo: HiloAbierto; puedeResponder: boolean; buzon: BuzonVisible | null; yoId: string; onResponder: PropsDeTarjeta['onResponder'] }) {
  const temaOscuro = useTemaOscuro()
  const [abiertos, setAbiertos] = useState<Set<string>>(() => abiertosAlEmpezar(hilo.mensajes))
  const alternar = (id: string) =>
    setAbiertos((previos) => {
      const siguientes = new Set(previos)
      if (!siguientes.delete(id)) siguientes.add(id)
      return siguientes
    })
  const plegados = hilo.mensajes.filter((m) => !abiertos.has(m.id)).length

  return (
    <div className="space-y-2">
      {hilo.recortado && (
        <p className="rounded-[10px] bg-[var(--ls-sup2)] px-3 py-2 text-[12px] text-[var(--ls-t3)]">Este hilo es muy largo: se enseñan los {hilo.mensajes.length} mensajes más recientes.</p>
      )}
      {plegados > 2 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setAbiertos(new Set(hilo.mensajes.map((m) => m.id)))}
            className={cn('rounded-[10px] px-2 text-[12px] font-medium text-[var(--ls-t3)] hover:text-[var(--ls-t1)]', TACTIL)}
          >
            Abrir los {plegados} plegados
          </button>
        </div>
      )}
      {hilo.mensajes.map((m) => (
        <Tarjeta key={m.id} mensaje={m} abierto={abiertos.has(m.id)} puedeResponder={puedeResponder} temaOscuro={temaOscuro} buzon={buzon} yoId={yoId} onAlternar={() => alternar(m.id)} onResponder={onResponder} />
      ))}
    </div>
  )
}

/** La franja «Lo lleva X · desde ayer» con [Hecho] y [Cambiar] */
function FranjaDeEncargo({
  asignacion,
  yoId,
  puedeHecho,
  puedeCambiar,
  onHecho,
  onCambiar,
}: {
  asignacion: NonNullable<HiloAbierto['asignacion']>
  yoId: string
  puedeHecho: boolean
  puedeCambiar: boolean
  onHecho: () => void
  onCambiar: () => void
}) {
  const reducir = useReducedMotion()
  const esMia = asignacion.personaId === yoId
  const desde = desdeCuando(asignacion.asignadoAt)
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] border px-3 py-2"
      style={{ borderColor: 'color-mix(in srgb, var(--ls-e-azul) 28%, transparent)', background: 'color-mix(in srgb, var(--ls-e-azul) 8%, transparent)' }}
    >
      <motion.span key={asignacion.personaId} initial={reducir ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 22 }} className="inline-flex">
        <Avatar nombre={asignacion.nombre} tamano={26} />
      </motion.span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-[var(--ls-t1)]">
          <span className="font-semibold">{esMia ? 'La llevas tú' : `Lo lleva ${asignacion.nombre.split(' ')[0]}`}</span>
          {desde && <span className="text-[var(--ls-t3)]"> · {desde}</span>}
        </p>
        {asignacion.nota && <p className="mt-0.5 break-words text-[12.5px] italic text-[var(--ls-t2)]">«{asignacion.nota}»</p>}
      </div>
      {(puedeHecho || puedeCambiar) && (
        <div className="flex shrink-0 gap-1.5">
          {puedeHecho && (
            <Boton tamano="sm" icono={Check} onClick={onHecho} title="Dar por hecha esta conversación (deja de estar en «Asignados a mí»)">
              Hecho
            </Boton>
          )}
          {puedeCambiar && (
            <Boton tamano="sm" variante="fantasma" onClick={onCambiar}>
              Cambiar
            </Boton>
          )}
        </div>
      )}
    </div>
  )
}

function InsigniaDeAcceso({ acceso }: { acceso: ReturnType<typeof accesoDelBuzon> }) {
  if (acceso === 'supervision') {
    return (
      <Insignia tono="ambar" icono={Eye} tamano="sm" title="Estás leyendo el buzón de otra persona: cada vez que miras queda anotado para los administradores">
        Solo lectura · queda anotado
      </Insignia>
    )
  }
  if (acceso === 'asignado') {
    return (
      <Insignia tono="azul" icono={UserCheck} tamano="sm" title="Un administrador te ha asignado este buzón: lo que lees y lo que envías desde él queda anotado">
        Asignado a ti · lo que lees y envías queda anotado
      </Insignia>
    )
  }
  return null
}

/** El menú ⋯ de la cabecera */
function MenuDelHilo({
  hilo,
  puedeResponder,
  puedeEncargar,
  remitente,
  onDestacar,
  onMarcarNoLeido,
  onAsignar,
  onSilenciarRemitente,
  onCopiarEnlace,
}: {
  hilo: HiloAbierto
  puedeResponder: boolean
  puedeEncargar: boolean
  remitente: { direccion: string; nombre: string } | null
  onDestacar: () => void
  onMarcarNoLeido: () => void
  onAsignar: () => void
  onSilenciarRemitente: (d: Duracion | 'quitar') => void
  onCopiarEnlace: () => void
}) {
  const remitenteSilenciado = hilo.silenciado.remitente
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        <button type="button" className={cn(BOTON_ICONO, 'data-[state=open]:bg-[var(--ls-sup3)]')} aria-label="Más acciones" title="Más acciones">
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content side="bottom" align="end" sideOffset={6} collisionPadding={16} className={CONTENIDO_DE_MENU}>
          {/* En el móvil la estrella y «Encargar» viven aquí (en la cabecera no caben con el asunto) */}
          {puedeResponder && (
            <Menu.Item className={cn(OPCION, 'md:hidden')} onSelect={onDestacar}>
              <Star className={cn('h-4 w-4 shrink-0', hilo.destacado ? 'fill-[var(--ls-e-ambar)] text-[var(--ls-e-ambar)]' : 'text-[var(--ls-t3)]')} aria-hidden />
              <span className="flex-1">{hilo.destacado ? 'Quitar la estrella' : 'Destacar'}</span>
            </Menu.Item>
          )}
          {puedeEncargar && (
            <Menu.Item className={cn(OPCION, 'md:hidden')} onSelect={onAsignar}>
              <UserPlus className="h-4 w-4 shrink-0 text-[var(--ls-t3)]" aria-hidden />
              <span className="flex-1">{hilo.asignacion ? 'Cambiar quién la lleva' : 'Encargar a alguien'}</span>
            </Menu.Item>
          )}
          {puedeResponder && (
            <Menu.Item className={OPCION} onSelect={onMarcarNoLeido}>
              <MailWarning className="h-4 w-4 shrink-0 text-[var(--ls-t3)]" aria-hidden />
              <span className="flex-1">Marcar no leído</span>
              <span className="hidden items-center gap-0.5 lg:inline-flex" aria-hidden>
                <Kbd>⇧</Kbd>
                <Kbd>U</Kbd>
              </span>
            </Menu.Item>
          )}
          <Menu.Sub>
            <Menu.SubTrigger className={cn(OPCION, 'data-[state=open]:bg-[var(--ls-sup3)]')} disabled={!remitente}>
              {remitenteSilenciado ? <BellOff className="h-4 w-4 shrink-0 text-[var(--ls-t2)]" aria-hidden /> : <BellOff className="h-4 w-4 shrink-0 text-[var(--ls-t3)]" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">{remitenteSilenciado ? 'Remitente silenciado' : 'Silenciar a este remitente'}</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)]" aria-hidden />
            </Menu.SubTrigger>
            <Menu.Portal>
              <Menu.SubContent sideOffset={4} collisionPadding={16} className={CONTENIDO_DE_MENU}>
                {remitente && (
                  <Menu.Label className="px-2.5 pb-1 pt-1.5">
                    <span className="block truncate text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t3)]">{remitente.direccion}</span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-[var(--ls-t4)]">En todos los buzones que lees. Solo para ti.</span>
                  </Menu.Label>
                )}
                <Menu.Separator className="my-1 h-px bg-[var(--ls-linea)]" />
                {DURACIONES.map((d) => (
                  <Menu.Item key={d} className={OPCION} onSelect={() => onSilenciarRemitente(d)}>
                    <span className="flex-1">{ETIQUETA_DE_DURACION[d]}</span>
                  </Menu.Item>
                ))}
                {remitenteSilenciado && (
                  <>
                    <Menu.Separator className="my-1 h-px bg-[var(--ls-linea)]" />
                    <Menu.Item className={cn(OPCION, 'font-medium')} onSelect={() => onSilenciarRemitente('quitar')}>
                      <BellRing className="h-4 w-4 shrink-0 text-[var(--ls-acc)]" aria-hidden />
                      <span className="flex-1">Quitar silencio</span>
                    </Menu.Item>
                  </>
                )}
              </Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub>
          <Menu.Separator className="my-1 h-px bg-[var(--ls-linea)]" />
          <Menu.Item className={OPCION} onSelect={onCopiarEnlace}>
            <Link2 className="h-4 w-4 shrink-0 text-[var(--ls-t3)]" aria-hidden />
            <span className="flex-1">Copiar enlace</span>
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}

/** La cabecera pegajosa: en el móvil deja sitio a la hamburguesa (fixed, 40 px en .875rem) */
function Cabecera({ children }: { children: ReactNode }) {
  return <header className="sticky top-[var(--cab-hueco,0px)] z-20 border-b border-[var(--ls-linea)] bg-[var(--ls-sup)] pl-1 md:static md:pl-0">{children}</header>
}

function BotonAtras({ onAtras }: { onAtras: () => void }) {
  return (
    <button type="button" onClick={onAtras} className={cn(BOTON_ICONO, 'md:hidden')} aria-label="Volver a la lista" title="Volver a la lista (u)">
      <ArrowLeft className="h-4 w-4" aria-hidden />
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* La vista                                                            */
/* ------------------------------------------------------------------ */

export function VistaDeHilo({
  hilo,
  cargando,
  error,
  buzon,
  puedeResponder,
  yoId,
  esAdmin,
  onAtras,
  onDestacar,
  onMarcarNoLeido,
  onSilenciarHilo,
  onSilenciarRemitente,
  onAsignar,
  onHecho,
  onResponder,
  onRespuestaEnviada,
}: PropsDeVistaDeHilo) {
  const reducir = useReducedMotion()

  if (error) {
    return (
      <div className="flex flex-col md:h-full md:min-h-0">
        <Cabecera>
          <div className="flex items-center gap-2 px-2 py-1.5 md:hidden">
            <BotonAtras onAtras={onAtras} />
          </div>
        </Cabecera>
        <EstadoVacio compacto icono={MailWarning} titulo="No se ha podido abrir la conversación" descripcion={<span role="alert">{error}</span>} acento="var(--ls-e-ambar)" />
      </div>
    )
  }

  if (!hilo) {
    if (cargando) {
      return (
        <div className="flex flex-col md:h-full md:min-h-0" aria-busy="true" aria-label="Abriendo la conversación">
          <Cabecera>
            <div className="flex items-center gap-2 px-2 py-2.5 md:px-5 md:py-4">
              <BotonAtras onAtras={onAtras} />
              <div className="min-w-0 flex-1 space-y-2">
                <Esqueleto className="h-5 w-2/3" />
                <Esqueleto className="h-3 w-1/3" />
              </div>
            </div>
          </Cabecera>
          <div className="space-y-2 p-3 lg:p-5">
            <div className="flex items-center gap-3 rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-2.5">
              <Esqueleto redondo className="h-6 w-6" />
              <Esqueleto className="h-3 w-1/2" />
            </div>
            <div className="rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-4">
              <div className="flex items-center gap-3">
                <Esqueleto redondo className="h-9 w-9" />
                <div className="flex-1 space-y-2">
                  <Esqueleto className="h-3 w-2/5" />
                  <Esqueleto className="h-2.5 w-1/4" />
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <Esqueleto className="h-2.5 w-full" />
                <Esqueleto className="h-2.5 w-11/12" />
                <Esqueleto className="h-2.5 w-3/5" />
              </div>
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center">
        <EstadoVacio
          icono={MailOpen}
          titulo="Elige una conversación"
          acento="marca"
          descripcion={
            <span className="mt-1 hidden flex-col items-center gap-1.5 text-[12.5px] text-[var(--ls-t3)] lg:inline-flex">
              <span className="inline-flex items-center gap-1.5">
                <Kbd>j</Kbd>
                <Kbd>k</Kbd> para moverte por la lista
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Kbd>↵</Kbd> para abrirla · <Kbd>c</Kbd> para redactar · <Kbd>?</Kbd> todos los atajos
              </span>
            </span>
          }
        />
      </div>
    )
  }

  return (
    <HiloCargado
      hilo={hilo}
      buzon={buzon}
      puedeResponder={puedeResponder}
      yoId={yoId}
      esAdmin={esAdmin}
      reducir={!!reducir}
      onAtras={onAtras}
      onDestacar={onDestacar}
      onMarcarNoLeido={onMarcarNoLeido}
      onSilenciarHilo={onSilenciarHilo}
      onSilenciarRemitente={onSilenciarRemitente}
      onAsignar={onAsignar}
      onHecho={onHecho}
      onResponder={onResponder}
      onRespuestaEnviada={onRespuestaEnviada}
    />
  )
}

type PropsDeHiloCargado = Omit<PropsDeVistaDeHilo, 'hilo' | 'cargando' | 'error' | 'esMio'> & { hilo: HiloAbierto; reducir: boolean }

function HiloCargado({
  hilo,
  buzon,
  puedeResponder,
  yoId,
  esAdmin,
  reducir,
  onAtras,
  onDestacar,
  onMarcarNoLeido,
  onSilenciarHilo,
  onSilenciarRemitente,
  onAsignar,
  onHecho,
  onResponder,
  onRespuestaEnviada,
}: PropsDeHiloCargado) {
  const objetivo = useMemo(() => mensajeAlQueContestar(hilo.mensajes), [hilo.mensajes])
  const remitente = useMemo(() => remitenteDelHilo(hilo.mensajes), [hilo.mensajes])
  const acceso = accesoDelBuzon(buzon)
  const silenciado = hilo.silenciado.hilo || hilo.silenciado.remitente
  const puedeEncargar = puedeResponder || esAdmin
  const esMia = hilo.asignacion?.personaId === yoId
  const variosEnObjetivo = !!objetivo && objetivo.para.length + objetivo.cc.length > 1
  const total = hilo.mensajes.length

  async function copiarEnlace() {
    try {
      const enlace = enlaceDelHilo(`${window.location.origin}/dashboard/correo`, hilo.buzonId, hilo.id)
      await navigator.clipboard.writeText(enlace)
      toast.success('Enlace copiado. Solo lo abre quien puede leer este buzón.')
    } catch {
      toast.error('No se ha podido copiar el enlace.')
    }
  }

  const responder = (modo: ModoDeRedactar) => objetivo && onResponder(modo, objetivo)

  return (
    <div className="flex flex-col md:h-full md:min-h-0">
      <Cabecera>
        <div className="flex items-start gap-1 px-2 py-2 md:gap-2 md:px-5 md:py-3.5">
          <BotonAtras onAtras={onAtras} />
          <div className="min-w-0 flex-1 pt-1.5 md:pt-0">
            <h2
              className="truncate text-[18px] font-semibold leading-tight tracking-[-0.015em] text-[var(--ls-t1)] md:line-clamp-2 md:whitespace-normal lg:text-[20px]"
              title={hilo.asunto}
            >
              {hilo.asunto || '(sin asunto)'}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12.5px] text-[var(--ls-t3)]">
              {buzon && (
                <span className="inline-flex min-w-0 items-center gap-1.5" title={buzon.direccion}>
                  <PuntoDeBuzon direccion={buzon.direccion} />
                  <span className="truncate font-medium text-[var(--ls-t2)]">{direccionCorta(buzon.direccion)}</span>
                </span>
              )}
              <span className="tabular-nums">
                {buzon && '· '}
                {total === 1 ? '1 mensaje' : `${total} mensajes`}
              </span>
              {silenciado && (
                <span title={hilo.silenciado.hilo ? 'Has silenciado esta conversación: no te avisa' : 'Has silenciado a este remitente: no te avisa en ningún buzón'}>
                  <InsigniaSilenciado texto hasta={null} />
                </span>
              )}
              <span className="hidden max-w-full md:contents">
                <InsigniaDeAcceso acceso={acceso} />
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            {puedeResponder && (
              <button
                type="button"
                onClick={onDestacar}
                className={cn(BOTON_ICONO, 'hidden md:inline-flex')}
                title={hilo.destacado ? 'Quitar la estrella (s)' : 'Destacar (s)'}
                aria-label={hilo.destacado ? 'Quitar la estrella' : 'Destacar'}
                aria-pressed={hilo.destacado}
              >
                <Star className={cn('h-4 w-4', hilo.destacado && 'fill-[var(--ls-e-ambar)] text-[var(--ls-e-ambar)]')} aria-hidden />
              </button>
            )}
            <span className="hidden md:inline-flex">
              <MenuDeSilencio silenciado={hilo.silenciado.hilo} hasta={null} onElegir={onSilenciarHilo} que="esta conversación" />
            </span>
            {puedeEncargar && (
              <button
                type="button"
                onClick={onAsignar}
                className={cn(BOTON_ICONO, 'hidden md:inline-flex')}
                title={hilo.asignacion ? `La lleva ${hilo.asignacion.nombre}: cambiar` : 'Encargar a alguien'}
                aria-label={hilo.asignacion ? `La lleva ${hilo.asignacion.nombre}. Cambiar quién la lleva` : 'Encargar esta conversación a alguien'}
              >
                {hilo.asignacion ? (
                  <motion.span key={hilo.asignacion.personaId} initial={reducir ? false : { scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }} className="inline-flex">
                    <Avatar nombre={hilo.asignacion.nombre} tamano={22} />
                  </motion.span>
                ) : (
                  <UserPlus className="h-4 w-4" aria-hidden />
                )}
              </button>
            )}
            <MenuDelHilo
              hilo={hilo}
              puedeResponder={puedeResponder}
              puedeEncargar={puedeEncargar}
              remitente={remitente}
              onDestacar={onDestacar}
              onMarcarNoLeido={onMarcarNoLeido}
              onAsignar={onAsignar}
              onSilenciarRemitente={onSilenciarRemitente}
              onCopiarEnlace={() => void copiarEnlace()}
            />
          </div>
        </div>
        {/* En el móvil la insignia de acceso va en su propia línea, para que no aplaste el asunto */}
        {acceso && acceso !== 'propio' && (
          <div className="-mt-0.5 overflow-hidden px-3 pb-2 md:hidden">
            <InsigniaDeAcceso acceso={acceso} />
          </div>
        )}
      </Cabecera>

      <div className="md:min-h-0 md:flex-1 md:overflow-y-auto">
        <motion.div
          key={hilo.id}
          initial={reducir ? false : { opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className="space-y-3 p-3 lg:p-5"
        >
          {hilo.asignacion && (
            <FranjaDeEncargo
              asignacion={hilo.asignacion}
              yoId={yoId}
              puedeHecho={esMia || puedeResponder}
              puedeCambiar={puedeEncargar}
              onHecho={onHecho}
              onCambiar={onAsignar}
            />
          )}
          {/* key: cada hilo empieza con sus mensajes plegados y abiertos como toca */}
          <Mensajes key={hilo.id} hilo={hilo} puedeResponder={puedeResponder} buzon={buzon} yoId={yoId} onResponder={onResponder} />
        </motion.div>
      </div>

      {/* Escritorio y tableta: responder rápido al pie */}
      {puedeResponder && buzon && objetivo && (
        <div className="hidden md:block">
          <RespuestaRapida
            hilo={hilo}
            buzon={buzon}
            mensaje={objetivo}
            onEnviado={(hiloId, asunto, detalle) => onRespuestaEnviada?.(hiloId, asunto, detalle)}
            onAbrirCompleto={(texto) => onResponder('responder', objetivo, texto)}
          />
        </div>
      )}

      {/* Móvil: barra pegajosa solo con botones, a la izquierda; 72 px libres a la derecha para el chat y los avisos */}
      <div className="sticky bottom-0 z-20 border-t border-[var(--ls-linea)] bg-[var(--ls-sup)] pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="flex items-center justify-start gap-1.5 py-2 pl-3 pr-[72px]">
          {puedeResponder && objetivo && (
            <>
              <button type="button" onClick={() => responder('responder')} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3.5 text-[14px] font-medium text-[var(--ls-t1)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)] active:bg-[var(--ls-sup3)]">
                <Reply className="h-4 w-4" aria-hidden /> Responder
              </button>
              {variosEnObjetivo && (
                <button type="button" onClick={() => responder('responder-todos')} className={BOTON_ICONO} aria-label="Responder a todos" title="Responder a todos">
                  <ReplyAll className="h-4 w-4" aria-hidden />
                </button>
              )}
              <button type="button" onClick={() => responder('reenviar')} className={BOTON_ICONO} aria-label="Reenviar" title="Reenviar">
                <Forward className="h-4 w-4" aria-hidden />
              </button>
            </>
          )}
          <MenuDeSilencio silenciado={hilo.silenciado.hilo} hasta={null} onElegir={onSilenciarHilo} que="esta conversación" lado="top" alinear="start" />
          {!puedeResponder && <span className="min-w-0 truncate pl-1 text-[12.5px] text-[var(--ls-t4)]">Solo lectura</span>}
        </div>
      </div>
    </div>
  )
}
