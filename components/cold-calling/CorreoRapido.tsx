'use client'

import { Loader2, Mail, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { Redactar, type DetalleDeEnvio } from '@/components/correo/Redactar'
import { BOTON_PRIMARIO, BOTON_SECUNDARIO } from '@/components/correo/ui'
import { escucharCorreoRapido, type PeticionDeCorreoRapido } from '@/lib/correo/correo-rapido'
import { apuntarCorreoEnLead } from '@/lib/correo/lead-cliente'
import { avisarCorreoEnviadoALead } from '@/lib/correo/peticiones'
import { textoSinFirma } from '@/lib/correo/plantillas'
import { borradorDe, type BorradorDeCorreo } from '@/lib/correo/redactar'
import type { BuzonVisible } from '@/lib/correo/tipos'
import { cargarMiBuzon, miBuzonEnMemoria } from './miBuzon'
import type { ResultadoDeMiBuzon } from './miBuzon'

/**
 * ESCRIBIR A UN LEAD SIN SALIR DE SU FICHA.
 * =========================================
 * Pulsar el correo de un lead, o «Correo con IA», abre el cuadro de escribir ENCIMA de Cold Calling: nada de irse a Correo, esperar,
 * escribir y volver. La aplicación de Correo queda para revisar bandejas, enviados y conversaciones.
 *
 * Es el mismo cuadro de Correo (components/correo/Redactar.tsx: plantillas, adjuntos, firma, «Redactar con IA»), así que se comporta igual.
 * Lo que añade esta ventana:
 *   · sale SIEMPRE desde el buzón de quien escribe (lib/correo/mi-buzon.ts); si no lo ha conectado o la contraseña falló, se lo dice y lo lleva a Correo;
 *   · al enviar, el correo ENTERO se apunta en el historial del lead (lib/correo/apunte.ts), se sella su último contacto y el historial se
 *     refresca solo (ColdCallingBoard escucha avisarCorreoEnviadoALead);
 *   · un aviso al enviar que dice a quién se envió y que ha quedado apuntado.
 *
 * Se monta UNA vez en el tablero y se queda escuchando encargos (lib/correo/correo-rapido.ts). Se pinta en el <body> (portal): no depende de
 * lo que lo rodee (Cold Calling se oculta con `visibility`, que se heredaría).
 */

type Estado =
  | { fase: 'cerrada' }
  | { fase: 'cargando' }
  | { fase: 'aviso'; titulo: string; texto: string; irACorreo: boolean }
  | { fase: 'lista'; peticion: PeticionDeCorreoRapido; buzon: BuzonVisible; borrador: BorradorDeCorreo }

interface Props {
  /** Quien escribe */
  yoId: string
  esAdmin: boolean
}

export function CorreoRapido({ yoId, esAdmin }: Props) {
  const router = useRouter()
  const [estado, setEstado] = useState<Estado>({ fase: 'cerrada' })
  const estadoActual = useRef<Estado>(estado)
  estadoActual.current = estado
  /** Cada apertura tiene su número: si se cierra mientras se carga el buzón, la respuesta que llegue tarde no la reabre */
  const apertura = useRef(0)

  // El buzón se pide una vez al montar, con el navegador parado, para que el primer clic no espere
  useEffect(() => {
    const t = setTimeout(() => void cargarMiBuzon(), 1500)
    return () => clearTimeout(t)
  }, [])

  const cerrar = useCallback(() => {
    apertura.current++
    setEstado({ fase: 'cerrada' })
  }, [])

  const aplicar = useCallback((peticion: PeticionDeCorreoRapido, r: ResultadoDeMiBuzon) => {
    if (r.tipo === 'listo') {
      const base = borradorDe('nuevo', null, { miDireccion: r.buzon.direccion, firma: r.buzon.firma })
      setEstado({ fase: 'lista', peticion, buzon: r.buzon, borrador: { ...base, para: peticion.para, lead: peticion.lead, generarIa: peticion.ia } })
    } else if (r.tipo === 'sin-buzon') {
      setEstado({ fase: 'aviso', irACorreo: true, titulo: 'Conecta tu correo para escribir desde aquí', texto: 'Todavía no tienes tu buzón conectado al ERP. Conéctalo en Correo (es la contraseña de tu correo de Hostinger, un minuto) y vuelve a pulsar.' })
    } else if (r.tipo === 'credenciales') {
      setEstado({ fase: 'aviso', irACorreo: true, titulo: 'Tu correo necesita la contraseña otra vez', texto: `El servidor ha rechazado la contraseña de ${r.direccion}. Vuelve a ponerla en Correo y sigue desde aquí.` })
    } else {
      setEstado({ fase: 'aviso', irACorreo: false, titulo: 'No se ha podido abrir el correo', texto: r.mensaje })
    }
  }, [])

  const abrir = useCallback(
    async (peticion: PeticionDeCorreoRapido) => {
      const numero = ++apertura.current
      // Con el buzón ya en memoria (se pide al montar) la ventana sale al momento, sin pasar ni un cuadro por «Preparando…»
      const sabido = miBuzonEnMemoria()
      if (sabido) return aplicar(peticion, sabido)
      setEstado({ fase: 'cargando' })
      const r = await cargarMiBuzon()
      if (numero !== apertura.current) return
      aplicar(peticion, r)
    },
    [aplicar]
  )

  // Escape cierra lo que no es el cuadro de escribir (ese se encarga solo, y pregunta antes de tirar lo escrito)
  const espera = estado.fase === 'cargando' || estado.fase === 'aviso'
  useEffect(() => {
    if (!espera) return
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cerrar()
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [espera, cerrar])

  // Un encargo mientras ya hay una ventana abierta no la pisa: lo que está escrito a medias es de alguien
  useEffect(
    () =>
      escucharCorreoRapido((peticion) => {
        if (estadoActual.current.fase !== 'cerrada') return
        void abrir(peticion)
      }),
    [abrir]
  )

  async function alEnviar(lista: Extract<Estado, { fase: 'lista' }>, asunto: string, detalle: DetalleDeEnvio) {
    cerrar()
    const lead = lista.peticion.lead
    const cuando = new Date().toISOString()
    const apuntado = await apuntarCorreoEnLead({ leadId: lead.id, userId: yoId, asunto, cuando, para: detalle.para, texto: textoSinFirma(detalle.texto, lista.buzon.firma) })
    // El tablero se entera y refresca el historial del lead y su último contacto
    if (apuntado) avisarCorreoEnviadoALead({ leadId: lead.id, asunto, cuando })
    const destino = detalle.para || lista.peticion.para
    if (detalle.conAviso) {
      // El correo salió pero algo no fue del todo bien: Redactar ya lo ha avisado. Aquí solo se dice qué pasó con el historial
      if (apuntado) toast.info(`Apuntado en el historial de ${lead.nombre}.`)
      else toast.warning('No se ha podido apuntar el correo en el historial: añádelo a mano.')
      return
    }
    toast.success(`Correo enviado a ${destino}`, {
      description: apuntado ? `Apuntado en el historial de ${lead.nombre}.` : 'No se ha podido apuntar en el historial: añádelo a mano.',
      duration: 7000,
    })
  }

  if (estado.fase === 'cerrada' || typeof document === 'undefined') return null

  if (estado.fase === 'lista') {
    return createPortal(
      <Redactar buzon={estado.buzon} yoId={yoId} esAdmin={esAdmin} borrador={estado.borrador} onCerrar={cerrar} onEnviado={(_hilo, asunto, detalle) => void alEnviar(estado, asunto, detalle)} sinAvisoDeExito />,
      document.body
    )
  }

  return createPortal(
    <Cartel onCerrar={cerrar}>
      {estado.fase === 'cargando' ? (
        <div className="flex items-center gap-3 px-5 py-4 text-[13px] text-[var(--ls-t2)]" role="status">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--ls-acc)]" aria-hidden /> Preparando tu correo…
        </div>
      ) : (
        <div className="space-y-3 p-5">
          <div className="flex items-start gap-3">
            <Mail className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ls-e-ambar)]" aria-hidden />
            <div className="min-w-0">
              <h2 className="text-[14px] font-semibold text-[var(--ls-t1)]">{estado.titulo}</h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--ls-t3)]">{estado.texto}</p>
            </div>
            <button type="button" onClick={cerrar} className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[var(--ls-t4)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]" aria-label="Cerrar">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={cerrar} className={BOTON_SECUNDARIO}>
              Cerrar
            </button>
            {estado.irACorreo && (
              <button
                type="button"
                onClick={() => {
                  cerrar()
                  router.push('/dashboard/correo')
                }}
                className={`${BOTON_PRIMARIO} !h-8 !px-3 !text-[12.5px]`}
              >
                Ir a Correo
              </button>
            )}
          </div>
        </div>
      )}
    </Cartel>,
    document.body
  )
}

/** Un cuadro pequeño centrado sobre fondo oscuro, para lo que no es el cuadro de escribir: esperar o avisar */
function Cartel({ children, onCerrar }: { children: ReactNode; onCerrar: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onCerrar()
        }
      }}
    >
      <div role="dialog" aria-modal="true" className="w-full max-w-[440px] overflow-hidden rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] shadow-2xl shadow-black/50">
        {children}
      </div>
    </div>
  )
}
