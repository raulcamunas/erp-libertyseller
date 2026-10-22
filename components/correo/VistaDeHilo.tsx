'use client'

import { ArrowLeft, ChevronDown, ChevronRight, Download, Forward, ImageOff, MailOpen, Moon, Paperclip, Reply, ReplyAll, Star, Sun } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Avatar, Esqueleto } from '@/components/rendimiento/ui'
import { nombreOCorreo, type Persona } from '@/lib/correo/direcciones'
import { fechaCompleta, fechaDeLista, tamanoLegible } from '@/lib/correo/formato'
import { tieneDisenoPropio, type FondoDeCorreo } from '@/lib/correo/html'
import type { ModoDeRedactar } from '@/lib/correo/redactar'
import type { HiloAbierto, MensajeDeHilo } from '@/lib/correo/tipos'
import { CuerpoDeCorreo } from './CuerpoDeCorreo'
import { useTemaOscuro } from './tema'
import { BOTON_ICONO, BOTON_SECUNDARIO, Etiqueta } from './ui'

/**
 * UN HILO ABIERTO: sus mensajes de más antiguo a más nuevo.
 *
 * Los mensajes ya leídos y viejos salen plegados en una línea (quién, un trozo y cuándo) y el último, y cualquiera que
 * esté sin leer, salen abiertos. Pulsar una línea la abre. El contenido va siempre dentro de un marco aislado
 * (CuerpoDeCorreo) y las imágenes de fuera no se cargan hasta que la persona lo pide.
 */

interface Props {
  hilo: HiloAbierto | null
  cargando: boolean
  error: string | null
  /** Es el buzón de quien mira: puede contestar, destacar y marcar. Si no, solo lee */
  esMio: boolean
  onAtras: () => void
  onDestacar: () => void
  onNoLeido: () => void
  onResponder: (modo: ModoDeRedactar, mensaje: MensajeDeHilo) => void
}

const HAY_IMAGENES_DE_FUERA = /<img\b[^>]*\bsrc\s*=\s*["']?https?:/i
const HAY_FONDOS_DE_FUERA = /url\(\s*["']?https?:/i

function destinatarios(personas: Persona[], maximo = 3): string {
  if (personas.length === 0) return ''
  const primeros = personas.slice(0, maximo).map(nombreOCorreo).join(', ')
  return personas.length > maximo ? `${primeros} y ${personas.length - maximo} más` : primeros
}

function Tarjeta({ mensaje, abierto, esMio, temaOscuro, onAlternar, onResponder }: { mensaje: MensajeDeHilo; abierto: boolean; esMio: boolean; temaOscuro: boolean; onAlternar: () => void; onResponder: (modo: ModoDeRedactar, m: MensajeDeHilo) => void }) {
  const [imagenes, setImagenes] = useState(false)
  // El fondo en que se enseña: oscuro si el ERP lo es y el correo no trae diseño propio (ni imágenes); si no, gris claro. Se puede cambiar a mano
  const [forzado, setForzado] = useState<FondoDeCorreo | null>(null)
  const conDiseno = useMemo(() => !!mensaje.html && tieneDisenoPropio(mensaje.html), [mensaje.html])
  const fondo: FondoDeCorreo = forzado ?? (temaOscuro && !conDiseno ? 'oscuro' : 'claro')
  const quien = mensaje.deNombre || mensaje.deDireccion || '(sin remitente)'
  const hayImagenesBloqueadas = useMemo(() => !!mensaje.html && (HAY_IMAGENES_DE_FUERA.test(mensaje.html) || HAY_FONDOS_DE_FUERA.test(mensaje.html)), [mensaje.html])
  const varios = mensaje.para.length + mensaje.cc.length > 1

  if (!abierto) {
    const trozo = mensaje.texto.replace(/\s+/g, ' ').trim().slice(0, 140)
    return (
      <button type="button" onClick={onAlternar} className="flex w-full items-center gap-2.5 rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-2 text-left transition-colors hover:bg-[var(--ls-sup2)]">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)]" aria-hidden />
        <Avatar id={mensaje.deDireccion || quien} nombre={quien} tamano={20} />
        <span className="w-24 shrink-0 truncate text-[12.5px] font-medium text-[var(--ls-t2)] sm:w-32">{mensaje.direccion === 'saliente' ? 'Tú' : quien}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--ls-t4)]">{trozo}</span>
        <time dateTime={mensaje.fecha} title={fechaCompleta(mensaje.fecha)} className="shrink-0 text-[11px] tabular-nums text-[var(--ls-t4)]">
          {fechaDeLista(mensaje.fecha)}
        </time>
      </button>
    )
  }

  return (
    <article className={`overflow-hidden rounded-[10px] border bg-[var(--ls-sup)] ${mensaje.leido ? 'border-[var(--ls-linea)]' : 'border-[var(--ls-acc-graf)]'}`}>
      <header className="flex items-start gap-2.5 px-3 py-2.5">
        <button type="button" onClick={onAlternar} aria-label="Plegar el mensaje" className="mt-0.5 shrink-0 text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </button>
        <Avatar id={mensaje.deDireccion || quien} nombre={quien} tamano={28} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="min-w-0 truncate text-[13px] font-semibold text-[var(--ls-t1)]">
              {mensaje.direccion === 'saliente' ? 'Tú' : quien}
              {mensaje.deNombre && mensaje.direccion !== 'saliente' && <span className="ml-1.5 text-[11.5px] font-normal text-[var(--ls-t4)]">&lt;{mensaje.deDireccion}&gt;</span>}
            </p>
            <span className="flex shrink-0 items-center gap-1.5">
              <time dateTime={mensaje.fecha} className="text-[11.5px] tabular-nums text-[var(--ls-t4)]">
                {fechaCompleta(mensaje.fecha)}
              </time>
              {temaOscuro && (
                <button
                  type="button"
                  onClick={() => setForzado(fondo === 'oscuro' ? 'claro' : 'oscuro')}
                  className="flex h-5 w-5 items-center justify-center rounded-[4px] text-[var(--ls-t4)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]"
                  title={fondo === 'oscuro' ? 'Ver este correo sobre fondo claro' : 'Ver este correo sobre fondo oscuro'}
                  aria-label={fondo === 'oscuro' ? 'Ver este correo sobre fondo claro' : 'Ver este correo sobre fondo oscuro'}
                >
                  {fondo === 'oscuro' ? <Sun className="h-3 w-3" aria-hidden /> : <Moon className="h-3 w-3" aria-hidden />}
                </button>
              )}
            </span>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-[var(--ls-t4)]">
            <span className="min-w-0 truncate" title={mensaje.para.map((p) => p.direccion).join(', ')}>
              para {destinatarios(mensaje.para) || '—'}
              {mensaje.cc.length > 0 && <> · cc {destinatarios(mensaje.cc)}</>}
            </span>
            {mensaje.automatico && <Etiqueta>Automático</Etiqueta>}
            {!mensaje.leido && <Etiqueta tono="acento">Nuevo</Etiqueta>}
          </p>
        </div>
      </header>

      {hayImagenesBloqueadas && !imagenes && (
        <p className="mx-3 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[6px] bg-[var(--ls-sup2)] px-2.5 py-1.5 text-[11.5px] text-[var(--ls-t3)]">
          <span className="flex items-center gap-1.5">
            <ImageOff className="h-3.5 w-3.5" aria-hidden /> Las imágenes de fuera están bloqueadas: quien lo envía sabría que lo has abierto.
          </span>
          <button type="button" onClick={() => setImagenes(true)} className="font-medium text-[var(--ls-acc)] underline underline-offset-2 hover:brightness-110">
            Mostrar imágenes
          </button>
        </p>
      )}

      <div className="px-3 pb-3">
        <CuerpoDeCorreo html={mensaje.html} texto={mensaje.texto} imagenesDeFuera={imagenes} fondo={fondo} />
      </div>

      {mensaje.adjuntos.length > 0 && (
        <ul className="flex flex-wrap gap-2 border-t border-[var(--ls-linea)] px-3 py-2.5" aria-label="Adjuntos">
          {mensaje.adjuntos.map((a) => (
            <li key={a.n}>
              <a
                href={`/api/correo/adjuntos?mensaje=${encodeURIComponent(mensaje.id)}&n=${a.n}`}
                download={a.nombre}
                className="inline-flex max-w-[260px] items-center gap-2 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2.5 py-1.5 text-[12px] text-[var(--ls-t2)] transition-colors hover:border-[var(--ls-linea2)] hover:text-[var(--ls-t1)]"
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

      {esMio && (
        <div className="flex flex-wrap gap-1.5 border-t border-[var(--ls-linea)] px-3 py-2">
          <button type="button" onClick={() => onResponder('responder', mensaje)} className={BOTON_SECUNDARIO}>
            <Reply className="h-3.5 w-3.5" aria-hidden /> Responder
          </button>
          {varios && (
            <button type="button" onClick={() => onResponder('responder-todos', mensaje)} className={BOTON_SECUNDARIO}>
              <ReplyAll className="h-3.5 w-3.5" aria-hidden /> Responder a todos
            </button>
          )}
          <button type="button" onClick={() => onResponder('reenviar', mensaje)} className={BOTON_SECUNDARIO}>
            <Forward className="h-3.5 w-3.5" aria-hidden /> Reenviar
          </button>
        </div>
      )}
    </article>
  )
}

function Mensajes({ hilo, esMio, onResponder }: { hilo: HiloAbierto; esMio: boolean; onResponder: Props['onResponder'] }) {
  const temaOscuro = useTemaOscuro()
  // Abiertos al empezar: el último y todo lo que esté sin leer
  const [abiertos, setAbiertos] = useState<Set<string>>(() => {
    const ids = new Set<string>(hilo.mensajes.filter((m) => !m.leido).map((m) => m.id))
    const ultimo = hilo.mensajes[hilo.mensajes.length - 1]
    if (ultimo) ids.add(ultimo.id)
    return ids
  })
  const alternar = (id: string) =>
    setAbiertos((previos) => {
      const siguientes = new Set(previos)
      if (!siguientes.delete(id)) siguientes.add(id)
      return siguientes
    })

  return (
    <div className="space-y-2">
      {hilo.recortado && <p className="rounded-[6px] bg-[var(--ls-sup2)] px-3 py-1.5 text-[11.5px] text-[var(--ls-t4)]">Este hilo es muy largo: se enseñan los {hilo.mensajes.length} mensajes más recientes.</p>}
      {hilo.mensajes.map((m) => (
        <Tarjeta key={m.id} mensaje={m} abierto={abiertos.has(m.id)} esMio={esMio} temaOscuro={temaOscuro} onAlternar={() => alternar(m.id)} onResponder={onResponder} />
      ))}
    </div>
  )
}

export function VistaDeHilo({ hilo, cargando, error, esMio, onAtras, onDestacar, onNoLeido, onResponder }: Props) {
  if (error) {
    return (
      <div className="flex h-full flex-col">
        <button type="button" onClick={onAtras} className={`${BOTON_ICONO} m-2 md:hidden`} aria-label="Volver a la lista">
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </button>
        <p className="p-6 text-[13px] text-[var(--ls-e-ambar)]" role="alert">
          {error}
        </p>
      </div>
    )
  }

  if (!hilo) {
    return cargando ? (
      <div className="space-y-3 p-4" aria-busy="true" aria-label="Abriendo la conversación">
        <Esqueleto className="h-5 w-2/3" />
        <Esqueleto className="h-24 w-full" />
        <Esqueleto className="h-24 w-full" />
      </div>
    ) : (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <MailOpen className="h-8 w-8 text-[var(--ls-t4)]" aria-hidden />
        <p className="text-[13px] text-[var(--ls-t3)]">Elige una conversación de la lista para leerla.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start gap-2 border-b border-[var(--ls-linea)] px-3 py-2.5">
        <button type="button" onClick={onAtras} className={`${BOTON_ICONO} md:hidden`} aria-label="Volver a la lista">
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </button>
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)]" title={hilo.asunto}>
            {hilo.asunto || '(sin asunto)'}
          </h2>
          <p className="text-[11.5px] text-[var(--ls-t4)]">{hilo.mensajes.length === 1 ? '1 mensaje' : `${hilo.mensajes.length} mensajes`}</p>
        </div>
        {esMio && (
          <div className="flex shrink-0 items-center gap-0.5">
            <button type="button" onClick={onDestacar} className={BOTON_ICONO} title={hilo.destacado ? 'Quitar la estrella' : 'Destacar'} aria-label={hilo.destacado ? 'Quitar la estrella' : 'Destacar'} aria-pressed={hilo.destacado}>
              <Star className={`h-4 w-4 ${hilo.destacado ? 'fill-[var(--ls-e-ambar)] text-[var(--ls-e-ambar)]' : ''}`} aria-hidden />
            </button>
            <button type="button" onClick={onNoLeido} className={BOTON_ICONO} title="Marcar como no leído" aria-label="Marcar como no leído">
              <MailOpen className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {/* key: cada hilo empieza con sus mensajes plegados y abiertos como toca */}
        <Mensajes key={hilo.id} hilo={hilo} esMio={esMio} onResponder={onResponder} />
      </div>
    </div>
  )
}
