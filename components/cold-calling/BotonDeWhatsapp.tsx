'use client'

import { ChevronDown, MessageCircle, Pencil } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { avisarApunteEnLead } from '@/lib/correo/peticiones'
import { apuntarWhatsappEnLead, leerMensajes, FALTA_LA_MIGRACION_247, type LecturaDeMensajes } from '@/lib/whatsapp/cliente'
import {
  AYUDA_DE_SITUACION,
  ETIQUETA_DE_SITUACION,
  LEAD_SIN_WHATSAPP,
  SITUACIONES_DE_WHATSAPP,
  elegirMensaje,
  enlaceDeWhatsapp,
  esViaDeWhatsapp,
  mensajesDeLaSituacion,
  nombreDePila,
  nombreParaElMensaje,
  numerosDeWhatsapp,
  rellenarMensaje,
  situacionDelLead,
  type MensajeDeWhatsapp,
  type SituacionDeWhatsapp,
  type ViaDeWhatsapp,
} from '@/lib/whatsapp/mensajes'
import { EditorDeMensajesDeWhatsapp } from './EditorDeMensajesDeWhatsapp'
import { MensajeDeWhatsappConIa } from './MensajeDeWhatsappConIa'
import { useMensajeDeWhatsappConIa } from './useMensajeDeWhatsappConIa'

/**
 * EL BOTÓN «WHATSAPP» DE LA FICHA DE UN LEAD.
 * ===========================================
 * Un clic abre el chat del móvil del lead con un mensaje ya escrito, y en ese mismo clic queda apuntado en su historial (con el mensaje entero y
 * el último contacto sellado). Se acabó copiar el número, abrir WhatsApp, pegarlo, escribir el mensaje, copiarlo y apuntarlo a mano.
 *
 *   · El mensaje es el que toca según el estado del lead (primer contacto · te he llamado y no contesta · después de hablar); si hay varios de esa
 *     situación se reparten entre los leads (lib/whatsapp/mensajes.ts). La flecha de al lado deja elegir otro mensaje u otro número.
 *   · El botón es un ENLACE de verdad (`<a target="_blank">`): el navegador lo abre sin que lo tape el bloqueador de ventanas, y el apunte se
 *     hace aparte, sin hacer esperar a nadie.
 *   · El apunte dice «abierto con este mensaje», no «enviado»: la aplicación no puede saber si luego se pulsa enviar.
 *   · Un mensaje con un campo sin rellenar ({{nombre}}…) NO se abre: es la misma regla que en los correos.
 *   · «Generar con IA» (components/cold-calling/MensajeDeWhatsappConIa.tsx), dentro del desplegable: la IA escribe el mensaje para el momento de este lead
 *     leyendo su historial, se edita en un cuadro y se abre igual que los demás. Su estado vive aquí, no en el desplegable: cerrarlo sin querer no lo pierde.
 *   · No se ofrece a un autónomo (a esos no se les llama en frío, la ficha lo dice), a quien ha dicho que no ni a un lead sin móvil.
 */

const CLAVE_DE_VIA = 'coldcalling.whatsapp.via'
const esUnMovil = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

/** Cómo se abre WhatsApp en este navegador: WhatsApp Web en un ordenador (lo habitual), `wa.me` en un móvil. Se recuerda lo que se elige */
function useViaDeWhatsapp(): [ViaDeWhatsapp, (v: ViaDeWhatsapp) => void] {
  const [via, setViaEstado] = useState<ViaDeWhatsapp>('web')
  useEffect(() => {
    let guardada: string | null = null
    try {
      guardada = window.localStorage.getItem(CLAVE_DE_VIA)
    } catch {
      // Sin almacenamiento (ventana privada…): se usa la de siempre
    }
    setViaEstado(esViaDeWhatsapp(guardada) ? guardada : esUnMovil() ? 'app' : 'web')
  }, [])
  const poner = useCallback((v: ViaDeWhatsapp) => {
    setViaEstado(v)
    try {
      window.localStorage.setItem(CLAVE_DE_VIA, v)
    } catch {
      // No pasa nada: la próxima vez vuelve a la de siempre
    }
  }, [])
  return [via, poner]
}

interface PerfilQueEscribe {
  id: string
  full_name: string | null
  email: string | null
  role: string
}

interface Props {
  lead: { id: string; store_name: string; company: string | null; status: string }
  /** Los teléfonos de la ficha, tal como están escritos */
  telefonos: readonly string[]
  currentUser: PerfilQueEscribe
}

const mismoMensaje = (a: MensajeDeWhatsapp, b: MensajeDeWhatsapp) => a.id === b.id && a.situacion === b.situacion && a.texto === b.texto

export function BotonDeWhatsapp({ lead, telefonos, currentUser }: Props) {
  const [via, ponerVia] = useViaDeWhatsapp()
  const [abierto, setAbierto] = useState(false)
  const [editando, setEditando] = useState(false)
  const [verOtras, setVerOtras] = useState(false)
  const [lectura, setLectura] = useState<LecturaDeMensajes | null>(null)
  const [numeroElegido, setNumeroElegido] = useState<string | null>(null)
  const ultimoApunte = useRef(0)
  const zonaIa = useRef<HTMLDivElement>(null)
  const esAdmin = currentUser.role === 'admin'

  useEffect(() => {
    let vivo = true
    void leerMensajes(currentUser.id).then((l) => vivo && setLectura(l))
    return () => {
      vivo = false
    }
  }, [currentUser.id])

  const recargar = useCallback(async () => setLectura(await leerMensajes(currentUser.id, true)), [currentUser.id])

  const numeros = useMemo(() => numerosDeWhatsapp(telefonos), [telefonos])
  const numero = numeros.find((n) => n.numero === numeroElegido) ?? numeros[0] ?? null
  const miNombre = nombreDePila(currentUser.full_name, currentUser.email)
  const empresa = nombreParaElMensaje(lead.store_name, lead.company)
  const situacion = situacionDelLead(lead.status)
  const guardados = lectura?.mensajes ?? null
  const sugerido = useMemo(() => elegirMensaje(mensajesDeLaSituacion(situacion, guardados), lead.id), [situacion, guardados, lead.id])
  const conIa = useMensajeDeWhatsappConIa(lead.id, situacion)

  if (!numero || LEAD_SIN_WHATSAPP.has(lead.status)) return null

  const preparar = (m: MensajeDeWhatsapp) => rellenarMensaje(m.texto, { empresa, miNombre })
  const enlaceDe = (texto: string) => enlaceDeWhatsapp({ numero: numero.numero, texto, via })

  /** Apunta en el historial que se ha abierto WhatsApp con este mensaje. Sin hacer esperar: la pestaña de WhatsApp ya se está abriendo */
  const alAbrir = (texto: string) => {
    // Un doble clic abre dos pestañas, pero no apunta dos veces lo mismo
    const ahora = Date.now()
    if (ahora - ultimoApunte.current < 2500) return
    ultimoApunte.current = ahora
    void (async () => {
      const r = await apuntarWhatsappEnLead({ leadId: lead.id, userId: currentUser.id, numero: numero.numero, texto })
      if (r.ok) {
        avisarApunteEnLead({ leadId: lead.id, asunto: 'WhatsApp', cuando: r.cuando })
        toast.success(`Apuntado en el historial de ${empresa || 'este lead'}.`)
      } else {
        toast.warning('Se ha abierto WhatsApp, pero no se ha podido apuntar en el historial: añádelo a mano.')
      }
    })()
  }

  const avisarDeCampos = (campos: string[]) => {
    const sinNombre = campos.includes('{{mi_nombre}}')
    toast.error(sinNombre ? 'No sé cómo te llamas: falta tu nombre en tu perfil.' : `Este mensaje lleva ${campos.join(', ')} y no se sabe rellenar. Cámbialo en «Editar mensajes».`)
  }

  const principal = preparar(sugerido)
  const principalListo = principal.sinRellenar.length === 0
  const clasePrincipal = 'inline-flex items-center gap-1.5 px-2.5 text-[12px] font-medium text-[var(--ls-t1)] transition-colors hover:bg-[var(--ls-sup3)]'
  const iconoDeWhatsapp = <MessageCircle className="h-3.5 w-3.5 text-[var(--ls-e-verde)]" aria-hidden />

  const fila = (m: MensajeDeWhatsapp, clave: string) => {
    const p = preparar(m)
    const esElSugerido = mismoMensaje(m, sugerido)
    const contenido = (
      <>
        <span className="line-clamp-3 min-w-0 flex-1 whitespace-pre-line text-[12px] leading-snug text-[var(--ls-t2)]">{p.texto}</span>
        {esElSugerido && <span className="shrink-0 rounded-[4px] bg-[color-mix(in_srgb,var(--ls-e-verde)_16%,transparent)] px-1 py-px text-[10px] font-medium text-[var(--ls-e-verde)]">sugerido</span>}
      </>
    )
    if (p.sinRellenar.length > 0) {
      return (
        <li key={clave}>
          <button type="button" onClick={() => avisarDeCampos(p.sinRellenar)} className="flex w-full flex-col gap-0.5 rounded-[6px] px-2 py-1.5 text-left opacity-70 hover:bg-[var(--ls-sup3)]">
            <span className="flex items-start gap-2">{contenido}</span>
            <span className="text-[11px] text-[var(--ls-e-ambar)]">No se puede abrir: falta {p.sinRellenar.join(', ')}</span>
          </button>
        </li>
      )
    }
    return (
      <li key={clave}>
        <a
          href={enlaceDe(p.texto)}
          target="_blank"
          rel="noopener noreferrer"
          title={p.texto}
          onClick={() => {
            alAbrir(p.texto)
            setAbierto(false)
          }}
          className="flex items-start gap-2 rounded-[6px] px-2 py-1.5 outline-none transition-colors hover:bg-[var(--ls-sup3)] focus-visible:shadow-[inset_0_0_0_1px_var(--ls-acc-graf)]"
        >
          {contenido}
        </a>
      </li>
    )
  }

  const grupo = (s: SituacionDeWhatsapp) => (
    <div key={s}>
      <p className="px-2 pb-0.5 pt-1.5 text-[10.5px] font-semibold text-[var(--ls-t4)]" title={AYUDA_DE_SITUACION[s]}>
        {ETIQUETA_DE_SITUACION[s]}
        {s === situacion && <span className="ml-1 font-normal">· la de este lead</span>}
      </p>
      <ul>{mensajesDeLaSituacion(s, guardados).map((m, i) => fila(m, `${s}-${m.id ?? 'serie'}-${i}`))}</ul>
    </div>
  )

  const segmentoDeVia = (valor: ViaDeWhatsapp, nombre: string, ayuda: string) => (
    <button
      type="button"
      onClick={() => ponerVia(valor)}
      aria-pressed={via === valor}
      title={ayuda}
      className={`inline-flex h-6 items-center rounded-[5px] px-2 text-[11.5px] transition-colors ${
        via === valor ? 'bg-[var(--ls-acc-suave)] text-[var(--ls-t1)] shadow-[inset_0_0_0_1px_var(--ls-acc-graf)]' : 'text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]'
      }`}
    >
      {nombre}
    </button>
  )

  return (
    <>
      <span className="group inline-flex h-8 items-stretch overflow-hidden rounded-[8px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] transition-colors hover:border-[var(--ls-acc-graf)]">
        {principalListo ? (
          <a
            href={enlaceDe(principal.texto)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => alAbrir(principal.texto)}
            title={`Abre WhatsApp con ${numero.telefono} y el mensaje ya escrito, y lo apunta en el historial:\n«${principal.texto.slice(0, 220)}${principal.texto.length > 220 ? '…' : ''}»`}
            className={clasePrincipal}
          >
            {iconoDeWhatsapp} WhatsApp
          </a>
        ) : (
          <button type="button" onClick={() => avisarDeCampos(principal.sinRellenar)} title="Este mensaje no se puede abrir todavía" className={`${clasePrincipal} opacity-80`}>
            {iconoDeWhatsapp} WhatsApp
          </button>
        )}
        <Popover
          open={abierto}
          onOpenChange={(v) => {
            setAbierto(v)
            if (!v) setVerOtras(false)
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Elegir otro mensaje u otro número de WhatsApp"
              title="Elegir otro mensaje u otro número"
              className="inline-flex w-7 items-center justify-center border-l border-[var(--ls-linea2)] text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]"
            >
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={8}
            collisionPadding={12}
            className="z-[80] max-h-[var(--radix-popover-content-available-height)] w-[min(400px,calc(100vw-1.5rem))] overflow-y-auto rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-0 text-[var(--ls-t2)] shadow-2xl"
            onKeyDown={(e) => e.key === 'Escape' && e.stopPropagation()}
            // Al abrir, el foco va al cuadro del mensaje de la IA si ya hay uno (escribir ahí no rompe nada) o al botón de generarlo: el primer elemento del
            // desplegable, por defecto, sería la «X» de descartar el mensaje, y un Intro nada más abrir lo borraría
            onOpenAutoFocus={(e) => {
              e.preventDefault()
              const zona = zonaIa.current
              ;(zona?.querySelector<HTMLElement>('textarea') ?? zona?.querySelector<HTMLElement>('button:not([disabled])'))?.focus({ preventScroll: true })
            }}
          >
            <div className="space-y-2 border-b border-[var(--ls-linea)] p-2.5">
              <p className="text-[11.5px] leading-snug text-[var(--ls-t3)]">Se abre el chat con el mensaje ya puesto: tú solo pulsas enviar. Queda apuntado en el historial del lead.</p>
              {numeros.length > 1 && (
                <div className="flex flex-wrap items-center gap-1" role="group" aria-label="A qué número">
                  <span className="mr-1 text-[11px] font-semibold text-[var(--ls-t4)]">A qué número</span>
                  {numeros.map((n) => (
                    <button
                      key={n.numero}
                      type="button"
                      onClick={() => setNumeroElegido(n.numero)}
                      aria-pressed={n.numero === numero.numero}
                      className={`inline-flex h-6 items-center rounded-[5px] border px-2 text-[11.5px] tabular-nums transition-colors ${
                        n.numero === numero.numero ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)] text-[var(--ls-t1)]' : 'border-[var(--ls-linea)] text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]'
                      }`}
                    >
                      {n.telefono}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div ref={zonaIa} className="border-b border-[var(--ls-linea)] p-2.5">
              <MensajeDeWhatsappConIa
                ia={conIa}
                situacion={situacion}
                enlaceDe={enlaceDe}
                alAbrir={(texto) => {
                  alAbrir(texto)
                  setAbierto(false)
                  // El mensaje ya se ha usado: la próxima vez se parte de cero
                  conIa.descartar()
                }}
              />
            </div>

            <div className="max-h-[320px] overflow-y-auto p-1.5">
              {grupo(situacion)}
              {verOtras ? (
                SITUACIONES_DE_WHATSAPP.filter((s) => s !== situacion).map(grupo)
              ) : (
                <button type="button" onClick={() => setVerOtras(true)} className="mt-1 w-full rounded-[6px] px-2 py-1.5 text-left text-[11.5px] text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]">
                  Ver los mensajes de otras situaciones
                </button>
              )}
            </div>

            <div className="space-y-2 border-t border-[var(--ls-linea)] p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold text-[var(--ls-t4)]">Abrir con</span>
                <div className="flex gap-0.5 rounded-[7px] bg-[var(--ls-sup2)] p-0.5" role="group" aria-label="Con qué se abre WhatsApp">
                  {segmentoDeVia('web', 'WhatsApp Web', 'Abre el chat directamente en WhatsApp Web (lo normal en un ordenador)')}
                  {segmentoDeVia('app', 'App o móvil', 'Abre el enlace de WhatsApp: lo recoge la aplicación de escritorio o el móvil')}
                </div>
                <button
                  type="button"
                  disabled={lectura?.faltaMigracion === true}
                  title={lectura?.faltaMigracion ? FALTA_LA_MIGRACION_247 : 'Cambiar, añadir o quitar mensajes'}
                  onClick={() => {
                    setAbierto(false)
                    setEditando(true)
                  }}
                  className="ml-auto inline-flex h-6 items-center gap-1 rounded-[6px] border border-[var(--ls-linea)] px-2 text-[11.5px] text-[var(--ls-t2)] transition-colors hover:border-[var(--ls-linea2)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)] disabled:cursor-default disabled:opacity-45"
                >
                  <Pencil className="h-3 w-3" aria-hidden /> Editar mensajes
                </button>
              </div>
              {lectura?.faltaMigracion && esAdmin && <p className="text-[11px] leading-snug text-[var(--ls-e-ambar)]">{FALTA_LA_MIGRACION_247}</p>}
              {lectura?.error && <p className="text-[11px] leading-snug text-[var(--ls-e-ambar)]">{lectura.error} Se ofrecen los de serie.</p>}
            </div>
          </PopoverContent>
        </Popover>
      </span>

      {editando && (
        <EditorDeMensajesDeWhatsapp
          yoId={currentUser.id}
          esAdmin={esAdmin}
          miNombre={miNombre}
          empresaDeEjemplo={empresa}
          situacionInicial={situacion}
          guardados={guardados ?? []}
          onCerrar={() => setEditando(false)}
          onCambio={recargar}
        />
      )}
    </>
  )
}
