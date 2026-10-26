'use client'

import { Loader2, MessageCircle, Sparkles, Undo2 } from 'lucide-react'
import { BOTON } from '@/lib/estilo/denso'
import { SUGERENCIAS_DE_CAMBIO_DE_WHATSAPP } from '@/lib/whatsapp/ia-cliente'
import { AYUDA_DE_SITUACION, type SituacionDeWhatsapp } from '@/lib/whatsapp/mensajes'
import type { BorradorDeWhatsapp } from './useBorradorDeWhatsapp'

/**
 * DONDE SE ESCRIBE EL MENSAJE DE WHATSAPP, DENTRO DEL DESPLEGABLE DEL BOTÓN — solo pinta; el estado vive en el botón (useBorradorDeWhatsapp).
 * ===========================================================================================================================================
 * El cuadro lleva SIEMPRE un mensaje: el sugerido para el momento del lead, uno que se elige de la lista o uno que escribe la IA leyendo su historial. Se puede
 * escribir encima en cualquier momento, y el botón de enviar abre WhatsApp con lo que haya EN ESE MOMENTO y lo apunta, tal cual, en el historial del lead. Por
 * eso el texto se cambia aquí y no en WhatsApp: lo que se cambie allí no llega al ERP.
 *
 *   · «Enviar por WhatsApp» es un ENLACE de verdad (`<a target="_blank">`): el navegador lo abre sin que lo tape el bloqueador de ventanas. El apunte lo hace el
 *     padre (`alEnviar`) con el texto tal como está en el cuadro. El ERP no puede saber si luego se pulsa enviar dentro de WhatsApp: el apunte dice «abierto».
 *   · Un hueco por rellenar ([…], {{…}}) impide enviar; el resto de reparos (largo, enlace…) se avisan pero decide quien lo manda.
 *   · «Deshacer» devuelve lo que había antes de elegir otro mensaje o de que la IA lo cambiara: una petición a la IA cuesta y un texto escrito a mano no se recupera.
 *   · Si la IA falla, el error se dice con una frase y el mensaje de siempre sigue en el cuadro: es una ayuda, nunca un paso obligatorio.
 */

interface Props {
  borrador: BorradorDeWhatsapp
  /** El momento actual del lead: es para el que se pide un mensaje a la IA */
  situacion: SituacionDeWhatsapp
  /** El enlace que abre WhatsApp con este texto: lo conoce el botón (el número, y WhatsApp Web o la aplicación) */
  enlaceDe: (texto: string) => string
  /** Apunta en el historial que se ha abierto WhatsApp con este texto y cierra el desplegable */
  alEnviar: (texto: string) => void
}

export function RedactorDeWhatsapp({ borrador: b, situacion, enlaceDe, alEnviar }: Props) {
  const conIa = b.origen === 'ia'
  const claseDelBotonEnviar = `${BOTON.base} ${BOTON.primario} !h-8 w-full justify-center !text-[12px]`

  return (
    <div className="space-y-2" aria-busy={b.generando}>
      <div className="flex items-start justify-between gap-2">
        {/* Sin cortar: «(retocado)» va al final y es lo que más importa saber, así que si no cabe junto al botón de volver, baja de línea */}
        <span className="inline-flex min-w-0 items-start gap-1 pt-1 text-[11px] font-semibold leading-snug text-[var(--ls-t3)]" title={AYUDA_DE_SITUACION[situacion]}>
          {conIa ? <Sparkles className="mt-px h-3 w-3 shrink-0 text-[var(--ls-acc)]" aria-hidden /> : <MessageCircle className="mt-px h-3 w-3 shrink-0 text-[var(--ls-e-verde)]" aria-hidden />}
          <span className="min-w-0">{b.etiqueta}</span>
        </span>
        {b.hayPrevio ? (
          <button type="button" onClick={b.deshacer} disabled={b.generando} title="Volver al texto que había antes" className={`${BOTON.chip} gap-1 disabled:cursor-default disabled:opacity-45`}>
            <Undo2 className="h-3 w-3" aria-hidden /> Deshacer
          </button>
        ) : (
          b.tocado && (
            <button type="button" onClick={b.restablecer} disabled={b.generando} title="Descartar lo escrito y volver al mensaje sugerido" className={`${BOTON.chip} disabled:cursor-default disabled:opacity-45`}>
              Volver al sugerido
            </button>
          )
        )}
      </div>

      <textarea
        value={b.texto}
        onChange={(e) => b.escribir(e.target.value)}
        // Lo que se teclea aquí es del mensaje: ningún atajo de la ficha ni del desplegable debe recogerlo
        onKeyDown={(e) => e.stopPropagation()}
        rows={6}
        readOnly={b.generando}
        spellCheck
        aria-label="Mensaje de WhatsApp: puedes escribirlo o cambiarlo antes de enviarlo"
        className={`w-full resize-none rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-2.5 text-[12.5px] leading-snug text-[var(--ls-t1)] outline-none transition-colors placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)] ${b.generando ? 'opacity-60' : ''}`}
      />

      {b.base && <p className="text-[11px] leading-snug text-[var(--ls-t4)]">Basado en: {b.base}</p>}
      {b.avisos.map((a) => (
        <p key={a} role="status" className="text-[11.5px] leading-snug text-[var(--ls-e-ambar)]">
          {a}
        </p>
      ))}
      {b.error && (
        <p role="alert" className="text-[11.5px] leading-snug text-[var(--ls-e-ambar)]">
          {b.error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => void b.generar()}
          disabled={b.generando}
          title="La IA escribe el mensaje para este momento con los datos y el historial de este lead (sin facturación). Después lo puedes cambiar a mano antes de enviarlo"
          className={`${BOTON.base} ${BOTON.secundario} !h-7 !text-[12px]`}
        >
          {b.generando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5 text-[var(--ls-acc)]" aria-hidden />}
          {b.generando ? 'Escribiendo…' : 'Generar con IA'}
        </button>
        {b.hayIa &&
          SUGERENCIAS_DE_CAMBIO_DE_WHATSAPP.map((s) => (
            <button key={s.etiqueta} type="button" onClick={() => void b.generar(s.indicacion)} disabled={b.generando} className={`${BOTON.chip} disabled:cursor-default disabled:opacity-45`}>
              {s.etiqueta}
            </button>
          ))}
      </div>

      {b.bloquea || b.generando ? (
        <button
          type="button"
          disabled
          title={b.listo === '' ? 'No hay nada escrito' : b.generando ? 'Espera a que la IA acabe' : 'Completa el hueco que ha quedado en el mensaje antes de enviar'}
          className={claseDelBotonEnviar}
        >
          <MessageCircle className="h-3.5 w-3.5" aria-hidden /> Enviar por WhatsApp
        </button>
      ) : (
        <a
          href={enlaceDe(b.listo)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => alEnviar(b.listo)}
          // El clic con la rueda también abre el enlace (en otra pestaña) y también tiene que quedar apuntado
          onAuxClick={(e) => e.button === 1 && alEnviar(b.listo)}
          title="Abre WhatsApp con este mensaje y lo apunta en el historial del lead tal como está aquí"
          className={claseDelBotonEnviar}
        >
          <MessageCircle className="h-3.5 w-3.5" aria-hidden /> Enviar por WhatsApp
        </a>
      )}
      <p className="text-[11px] leading-snug text-[var(--ls-t4)]">
        Se abre WhatsApp con este texto y queda apuntado en el historial tal cual está aquí: tú solo pulsas enviar allí. Retócalo aquí, no en WhatsApp: lo que cambies allí no llega al ERP.
      </p>
    </div>
  )
}
