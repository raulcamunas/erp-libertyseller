'use client'

import { Loader2, MessageCircle, Sparkles, X } from 'lucide-react'
import { BOTON } from '@/lib/estilo/denso'
import { SUGERENCIAS_DE_CAMBIO_DE_WHATSAPP } from '@/lib/whatsapp/ia-cliente'
import { AYUDA_DE_SITUACION, ETIQUETA_DE_SITUACION, type SituacionDeWhatsapp } from '@/lib/whatsapp/mensajes'
import type { MensajeConIa } from './useMensajeDeWhatsappConIa'

/**
 * «GENERAR CON IA» DENTRO DEL DESPLEGABLE DE WHATSAPP DE LA FICHA — solo pinta; el estado vive en el botón (useMensajeDeWhatsappConIa).
 * ===================================================================================================================================
 * Un clic y la IA escribe el mensaje para ESTE momento del lead (primer contacto, te he llamado y no contesta, después de hablar) leyendo lo mismo que
 * «Correo con IA»: sus datos y su historial, sin facturación. El mensaje aparece en un cuadro que se puede editar; debajo, unos atajos para pedir un
 * cambio («Más corto», «Más cercano», «Más directo», «Otra versión») y el botón que abre WhatsApp con ese texto y lo apunta en el historial.
 *
 *   · El botón que abre WhatsApp es un ENLACE de verdad (`<a target="_blank">`), como el resto del botón de WhatsApp: el navegador lo abre sin que lo
 *     tape el bloqueador de ventanas. El apunte lo hace el padre (`alAbrir`), con el texto tal como está en el cuadro en ese momento.
 *   · Un hueco por rellenar ([…], {{…}}) impide abrir WhatsApp; el resto de reparos (largo, enlace…) se avisan pero decide quien lo manda.
 *   · Si la IA falla, el error se dice con una frase y los mensajes de siempre siguen ahí debajo: es una ayuda, nunca un paso obligatorio.
 */

interface Props {
  ia: MensajeConIa
  /** El momento actual del lead: es para el que se pide un mensaje nuevo */
  situacion: SituacionDeWhatsapp
  /** El enlace que abre WhatsApp con este texto: lo conoce el botón (el número, y WhatsApp Web o la aplicación) */
  enlaceDe: (texto: string) => string
  /** Apunta en el historial que se ha abierto WhatsApp con este texto y cierra el desplegable */
  alAbrir: (texto: string) => void
}

export function MensajeDeWhatsappConIa({ ia, situacion, enlaceDe, alAbrir }: Props) {
  if (ia.texto === null) {
    return (
      <div className="space-y-1.5">
        <button
          type="button"
          onClick={() => void ia.generar()}
          disabled={ia.generando}
          title="La IA escribe el mensaje con los datos y el historial de este lead (sin facturación). Lo puedes cambiar antes de abrir WhatsApp"
          className={`${BOTON.base} ${BOTON.secundario} !h-8 w-full justify-center !text-[12px]`}
        >
          {ia.generando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5 text-[var(--ls-acc)]" aria-hidden />}
          {ia.generando ? 'Leyendo la ficha y escribiendo…' : 'Generar con IA para este momento'}
        </button>
        <p className="text-[11px] leading-snug text-[var(--ls-t4)]" title={AYUDA_DE_SITUACION[situacion]}>
          {ETIQUETA_DE_SITUACION[situacion]} · lee el historial de este lead y lo escribe a su medida. Lo editas antes de abrir WhatsApp.
        </p>
        {ia.error && (
          <p role="alert" className="text-[11.5px] leading-snug text-[var(--ls-e-ambar)]">
            {ia.error}
          </p>
        )}
      </div>
    )
  }

  const para = ia.situacion ?? situacion
  return (
    <div className="space-y-2" aria-busy={ia.generando}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1 text-[11px] font-semibold text-[var(--ls-t3)]" title={AYUDA_DE_SITUACION[para]}>
          <Sparkles className="h-3 w-3 shrink-0 text-[var(--ls-acc)]" aria-hidden />
          <span className="truncate">Escrito con IA · {ETIQUETA_DE_SITUACION[para]}</span>
        </span>
        <button type="button" onClick={ia.descartar} aria-label="Descartar este mensaje" title="Descartar este mensaje" className={BOTON.icono}>
          <X className="h-3 w-3" aria-hidden />
        </button>
      </div>

      <textarea
        value={ia.texto}
        onChange={(e) => ia.escribir(e.target.value)}
        // Lo que se teclea aquí es del mensaje: ningún atajo de la ficha ni del desplegable debe recogerlo
        onKeyDown={(e) => e.stopPropagation()}
        rows={5}
        readOnly={ia.generando}
        aria-label="Mensaje de WhatsApp escrito con IA: puedes cambiarlo antes de abrir WhatsApp"
        className={`w-full resize-none rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-2.5 text-[12.5px] leading-snug text-[var(--ls-t1)] outline-none transition-colors placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)] ${ia.generando ? 'opacity-60' : ''}`}
      />

      {ia.base && <p className="text-[11px] leading-snug text-[var(--ls-t4)]">Basado en: {ia.base}</p>}
      {ia.avisos.map((a) => (
        <p key={a} role="status" className="text-[11.5px] leading-snug text-[var(--ls-e-ambar)]">
          {a}
        </p>
      ))}
      {ia.error && (
        <p role="alert" className="text-[11.5px] leading-snug text-[var(--ls-e-ambar)]">
          {ia.error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {SUGERENCIAS_DE_CAMBIO_DE_WHATSAPP.map((s) => (
          <button key={s.etiqueta} type="button" onClick={() => void ia.generar(s.indicacion)} disabled={ia.generando} className={`${BOTON.chip} disabled:cursor-default disabled:opacity-45`}>
            {s.etiqueta}
          </button>
        ))}
        {ia.generando && (
          <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ls-t4)]" role="status">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Escribiendo…
          </span>
        )}
      </div>

      {ia.bloquea || ia.generando ? (
        <button
          type="button"
          disabled
          title={ia.listo === '' ? 'No hay nada escrito' : ia.generando ? 'Espera a que la IA acabe' : 'Completa el hueco que ha quedado en el mensaje antes de abrir WhatsApp'}
          className={`${BOTON.base} ${BOTON.primario} !h-8 w-full justify-center !text-[12px]`}
        >
          <MessageCircle className="h-3.5 w-3.5" aria-hidden /> Abrir WhatsApp con este mensaje
        </button>
      ) : (
        <a
          href={enlaceDe(ia.listo)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => alAbrir(ia.listo)}
          title="Abre WhatsApp con este mensaje y lo apunta en el historial del lead"
          className={`${BOTON.base} ${BOTON.primario} !h-8 w-full justify-center !text-[12px]`}
        >
          <MessageCircle className="h-3.5 w-3.5" aria-hidden /> Abrir WhatsApp con este mensaje
        </a>
      )}
    </div>
  )
}
