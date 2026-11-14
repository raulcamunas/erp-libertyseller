'use client'

import { useCallback, useRef, useState, type DragEvent } from 'react'
import { toast } from 'sonner'
import { UploadCloud } from 'lucide-react'

const traeFicheros = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

/**
 * ARRASTRAR ARCHIVOS AL CHAT. Devuelve lo que hay que esparcir sobre el contenedor (`props`) y si hay algo encima (`encima`). Los contadores evitan el parpadeo que hace el navegador al pasar el
 * ratón por los elementos de dentro. Las carpetas no se pueden subir (el navegador las entrega como un archivo vacío): se avisa y se sigue con el resto.
 */
export function useZonaDeSoltar({ activa = true, alSoltar }: { activa?: boolean; alSoltar: (ficheros: File[]) => void }) {
  const [encima, setEncima] = useState(false)
  const dentro = useRef(0)

  const alEntrar = useCallback(
    (e: DragEvent) => {
      if (!activa || !traeFicheros(e)) return
      e.preventDefault()
      dentro.current += 1
      setEncima(true)
    },
    [activa]
  )
  const alPasar = useCallback(
    (e: DragEvent) => {
      if (!activa || !traeFicheros(e)) return
      // Sin esto el navegador no deja soltar
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    [activa]
  )
  const alSalir = useCallback(
    (e: DragEvent) => {
      if (!activa || !traeFicheros(e)) return
      dentro.current = Math.max(0, dentro.current - 1)
      if (dentro.current === 0) setEncima(false)
    },
    [activa]
  )
  const alSoltarAqui = useCallback(
    (e: DragEvent) => {
      if (!traeFicheros(e)) return
      e.preventDefault()
      dentro.current = 0
      setEncima(false)
      if (!activa) return
      const ficheros: File[] = []
      let carpetas = 0
      const items = Array.from(e.dataTransfer.items ?? [])
      if (items.length > 0) {
        for (const item of items) {
          if (item.kind !== 'file') continue
          const entrada = (item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory: boolean } | null }).webkitGetAsEntry?.()
          if (entrada?.isDirectory) carpetas += 1
          else {
            const f = item.getAsFile()
            if (f) ficheros.push(f)
          }
        }
      } else ficheros.push(...Array.from(e.dataTransfer.files))
      if (carpetas > 0) toast.message(carpetas === 1 ? 'Las carpetas no se pueden subir: comprímela en un .zip.' : 'Las carpetas no se pueden subir: comprímelas en un .zip.')
      if (ficheros.length > 0) alSoltar(ficheros)
    },
    [activa, alSoltar]
  )

  return { encima, props: { onDragEnter: alEntrar, onDragOver: alPasar, onDragLeave: alSalir, onDrop: alSoltarAqui } }
}

/** El aviso grande que tapa la zona mientras se arrastran archivos encima */
export function AvisoDeSoltar({ donde, permitido = true }: { donde: string; permitido?: boolean }) {
  return (
    <div className="chat-zona-soltar" data-prohibido={permitido ? undefined : 'true'} role="presentation">
      <div>
        <UploadCloud className="h-9 w-9" />
        <b>{permitido ? `Suelta para adjuntar a ${donde}` : 'Únete al canal para poder adjuntar archivos'}</b>
        {permitido && <span>Fotos, PDF, Excel, Word… hasta 10 archivos de 25 MB</span>}
      </div>
    </div>
  )
}

