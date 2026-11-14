'use client'

import { useState } from 'react'
import { ExternalLink, File, FileSpreadsheet, FileText, Folder, ClipboardList, Presentation, Eye, EyeOff } from 'lucide-react'
import { leerEnlaceDeGoogle, type TipoDeEnlaceGoogle } from '@/lib/tareas-clientes/enlace-google'

const ICONO: Record<TipoDeEnlaceGoogle, typeof File> = {
  documento: FileText,
  hoja: FileSpreadsheet,
  presentacion: Presentation,
  archivo: File,
  carpeta: Folder,
  formulario: ClipboardList,
}

/**
 * LA TARJETA DE UN ENLACE DE GOOGLE BAJO EL CAMPO «ENLACE» de una tarea: si lo pegado es un documento, hoja, presentación, archivo o carpeta de Google (lib/tareas-clientes/enlace-google.ts), dice qué es, deja verlo
 * aquí mismo (la vista previa de Google, incrustada) y abrirlo en Drive. Cualquier otro enlace no pinta nada. El visor no se carga hasta pulsar «Ver aquí»: así abrir una tarea no dispara una página de Google
 * por cada una. Quien lo mira necesita acceso al archivo con su cuenta de Google; si no lo tiene, Google se lo dirá dentro del propio visor.
 */
export function VisorDeEnlace({ url }: { url: string | null | undefined }) {
  const [abierto, setAbierto] = useState(false)
  const enlace = leerEnlaceDeGoogle(url)
  if (!enlace) return null
  const Icono = ICONO[enlace.tipo]
  return (
    <div className="tc-enlace">
      <div className="tc-enlace-cabecera">
        <span className="tc-enlace-icono" data-tipo={enlace.tipo} aria-hidden>
          <Icono className="h-4 w-4" />
        </span>
        <span className="tc-enlace-texto">
          <b>{enlace.etiqueta}</b>
          <i>Google Drive</i>
        </span>
        {enlace.visor && (
          <button type="button" className="tc-enlace-boton" onClick={() => setAbierto((a) => !a)} aria-expanded={abierto}>
            {abierto ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {abierto ? 'Ocultar' : 'Ver aquí'}
          </button>
        )}
        <a className="tc-enlace-boton" href={enlace.abrir} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="h-3.5 w-3.5" />
          Abrir en {enlace.tipo === 'formulario' ? 'Google' : 'Drive'}
        </a>
      </div>
      {abierto && enlace.visor && (
        <>
          <iframe
            className="tc-enlace-visor"
            src={enlace.visor}
            title={enlace.etiqueta}
            loading="lazy"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
          />
          <small className="tc-enlace-nota">Si pide acceso, es que tu cuenta de Google no tiene permiso sobre el archivo.</small>
        </>
      )}
    </div>
  )
}
