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
import { RedactorDeWhatsapp } from './RedactorDeWhatsapp'
import { useBorradorDeWhatsapp } from './useBorradorDeWhatsapp'

/**
 * EL BOTÓN «WHATSAPP» DE LA FICHA DE UN LEAD.
 * ===========================================
 * Un solo botón, y siempre hace lo mismo: abrir el cuadro donde se ESCRIBE el mensaje. Ya no abre WhatsApp de golpe con un texto que nadie ha mirado: el
 * mensaje se escribe (o lo escribe la IA), se retoca aquí, y al pulsar «Enviar por WhatsApp» se abre el chat del móvil del lead con ese texto y queda
 * apuntado en su historial TAL CUAL está en el cuadro (con el último contacto sellado). Lo que se cambie dentro de WhatsApp no llega al ERP, y por eso se
 * cambia antes, aquí.
 *
 *   · El cuadro arranca con el mensaje que toca según el estado del lead (primer contacto · te he llamado y no contesta · después de hablar); si hay varios de
 *     esa situación se reparten entre los leads (lib/whatsapp/mensajes.ts). Otro mensaje de la lista, o uno de «Generar con IA» (la IA lo escribe leyendo el
 *     historial del lead), pasa al cuadro y se retoca igual. El estado vive aquí, no en el desplegable: cerrarlo sin querer no pierde lo escrito
 *     (components/cold-calling/useBorradorDeWhatsapp.ts; las reglas, en lib/whatsapp/borrador.ts).
 *   · «Enviar por WhatsApp» es un ENLACE de verdad (`<a target="_blank">`): el navegador lo abre sin que lo tape el bloqueador de ventanas, y el apunte se
 *     hace aparte, sin hacer esperar a nadie.
 *   · El apunte dice «abierto con este mensaje», no «enviado»: la aplicación no puede saber si luego se pulsa enviar.
 *   · Un mensaje con un hueco sin rellenar ({{nombre}}, […]) NO se envía: es la misma regla que en los correos. Se rellena a mano en el propio cuadro.
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

/** Qué falta en un mensaje de la lista que lleva campos sin rellenar. Se puede elegir igualmente: el hueco se completa a mano en el cuadro */
const notaDeHueco = (campos: string[]) =>
  campos.includes('{{mi_nombre}}') ? 'Falta tu nombre en tu perfil: escríbelo tú en el mensaje.' : `Lleva ${campos.join(', ')} sin rellenar: complétalo en el mensaje.`

export function BotonDeWhatsapp({ lead, telefonos, currentUser }: Props) {
  const [via, ponerVia] = useViaDeWhatsapp()
  const [abierto, setAbierto] = useState(false)
  const [editando, setEditando] = useState(false)
  const [verLista, setVerLista] = useState(false)
  const [verOtras, setVerOtras] = useState(false)
  const [lectura, setLectura] = useState<LecturaDeMensajes | null>(null)
  const [numeroElegido, setNumeroElegido] = useState<string | null>(null)
  const ultimoApunte = useRef(0)
  const zonaDelMensaje = useRef<HTMLDivElement>(null)
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
  const textoSugerido = rellenarMensaje(sugerido.texto, { empresa, miNombre }).texto
  // Lo que hay en el cuadro. Va ANTES del `return null` de abajo: un hook no puede depender de si el botón se pinta o no
  const borrador = useBorradorDeWhatsapp(lead.id, situacion, textoSugerido)

  if (!numero || LEAD_SIN_WHATSAPP.has(lead.status)) return null

  const preparar = (m: MensajeDeWhatsapp) => rellenarMensaje(m.texto, { empresa, miNombre })
  const enlaceDe = (texto: string) => enlaceDeWhatsapp({ numero: numero.numero, texto, via })

  /** El foco al cuadro del mensaje, con el cursor al final: lo siguiente que se hace es retocarlo */
  const enfocarElCuadro = () => {
    const caja = zonaDelMensaje.current?.querySelector<HTMLTextAreaElement>('textarea')
    if (!caja) return
    caja.focus({ preventScroll: true })
    caja.setSelectionRange(caja.value.length, caja.value.length)
  }

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

  /** Un mensaje de la lista: al pulsarlo pasa al cuadro (NO abre WhatsApp: se retoca y se envía desde el botón de abajo) */
  const fila = (m: MensajeDeWhatsapp, clave: string) => {
    const p = preparar(m)
    const esElSugerido = mismoMensaje(m, sugerido)
    return (
      <li key={clave}>
        <button
          type="button"
          onClick={() => {
            borrador.elegir(p.texto)
            setVerLista(false)
            // Cuando React ya ha puesto el texto nuevo, para que el cursor quede al final de él
            window.setTimeout(enfocarElCuadro, 0)
          }}
          disabled={borrador.generando}
          title={`Pasa este mensaje al cuadro para retocarlo y enviarlo:\n«${p.texto}»`}
          className="flex w-full flex-col gap-0.5 rounded-[6px] px-2 py-1.5 text-left outline-none transition-colors hover:bg-[var(--ls-sup3)] focus-visible:shadow-[inset_0_0_0_1px_var(--ls-acc-graf)] disabled:cursor-default disabled:opacity-60"
        >
          <span className="flex items-start gap-2">
            <span className="line-clamp-3 min-w-0 flex-1 whitespace-pre-line text-[12px] leading-snug text-[var(--ls-t2)]">{p.texto}</span>
            {esElSugerido && <span className="shrink-0 rounded-[4px] bg-[color-mix(in_srgb,var(--ls-e-verde)_16%,transparent)] px-1 py-px text-[10px] font-medium text-[var(--ls-e-verde)]">sugerido</span>}
          </span>
          {p.sinRellenar.length > 0 && <span className="text-[11px] text-[var(--ls-e-ambar)]">{notaDeHueco(p.sinRellenar)}</span>}
        </button>
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
      <Popover
        open={abierto}
        onOpenChange={(v) => {
          setAbierto(v)
          if (!v) {
            setVerLista(false)
            setVerOtras(false)
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            title={`Escribir un WhatsApp a ${numero.telefono}: se abre con el mensaje ya puesto y queda apuntado en el historial del lead`}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] pl-2.5 pr-2 text-[12px] font-medium text-[var(--ls-t1)] outline-none transition-colors hover:border-[var(--ls-acc-graf)] hover:bg-[var(--ls-sup3)] focus-visible:border-[var(--ls-acc-graf)] data-[state=open]:border-[var(--ls-acc-graf)]"
          >
            <MessageCircle className="h-3.5 w-3.5 text-[var(--ls-e-verde)]" aria-hidden /> WhatsApp
            <ChevronDown className="h-3.5 w-3.5 text-[var(--ls-t3)]" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="z-[80] max-h-[var(--radix-popover-content-available-height)] w-[min(400px,calc(100vw-1.5rem))] overflow-y-auto rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-0 text-[var(--ls-t2)] shadow-2xl"
          onKeyDown={(e) => e.key === 'Escape' && e.stopPropagation()}
          // Al abrir, el foco va al cuadro del mensaje: se puede escribir de inmediato. Escribir ahí no rompe nada (un Intro solo añade una línea), a diferencia
          // del primer botón del desplegable, que sería uno de «Deshacer» o de la IA
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            enfocarElCuadro()
          }}
        >
          <div className="space-y-2.5 p-2.5">
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label={numeros.length > 1 ? 'A qué número' : 'Número al que se escribe'}>
              <span className="mr-1 text-[11px] font-semibold text-[var(--ls-t4)]">{numeros.length > 1 ? 'A qué número' : 'Para'}</span>
              {numeros.length > 1 ? (
                numeros.map((n) => (
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
                ))
              ) : (
                <span className="text-[12px] tabular-nums text-[var(--ls-t2)]">{numero.telefono}</span>
              )}
            </div>

            <div ref={zonaDelMensaje}>
              <RedactorDeWhatsapp
                borrador={borrador}
                situacion={situacion}
                enlaceDe={enlaceDe}
                alEnviar={(texto) => {
                  alAbrir(texto)
                  setAbierto(false)
                  // El mensaje ya se ha usado: la próxima vez se parte del sugerido
                  borrador.restablecer()
                }}
              />
            </div>
          </div>

          <div className="border-t border-[var(--ls-linea)] p-1.5">
            <button
              type="button"
              onClick={() => setVerLista((v) => !v)}
              aria-expanded={verLista}
              className="flex w-full items-center gap-1 rounded-[6px] px-2 py-1.5 text-left text-[11.5px] text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]"
            >
              <ChevronDown className={`h-3 w-3 transition-transform ${verLista ? 'rotate-180' : ''}`} aria-hidden /> Elegir otro mensaje de la lista
            </button>
            {verLista && (
              <div className="mt-0.5 max-h-[260px] overflow-y-auto">
                {grupo(situacion)}
                {verOtras ? (
                  SITUACIONES_DE_WHATSAPP.filter((s) => s !== situacion).map(grupo)
                ) : (
                  <button type="button" onClick={() => setVerOtras(true)} className="mt-1 w-full rounded-[6px] px-2 py-1.5 text-left text-[11.5px] text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]">
                    Ver los mensajes de otras situaciones
                  </button>
                )}
              </div>
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
                title={lectura?.faltaMigracion ? FALTA_LA_MIGRACION_247 : 'Cambiar, añadir o quitar mensajes de la lista'}
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
