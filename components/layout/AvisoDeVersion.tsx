'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { PREGUNTAR_VERSION_CADA_MS, decidirAviso, idDeRespuesta } from '@/lib/sistema/version-cliente'

const CLAVE_DESCARTADA = 'version:descartada'

/**
 * UN BANNER DISCRETO ARRIBA CUANDO HAY UNA VERSIÓN NUEVA DEL ERP. Cada pantalla se pinta con la versión que había en ese momento (`idInicial`, la lee el layout del servidor); la pestaña pregunta cada minuto
 * (con ella a la vista, y al volver a ella o recuperar la red) cuál es la de ahora, y si es otra avisa: «Hay una versión nueva del ERP» con un botón para actualizar. La «x» lo quita para ESA versión; el
 * siguiente despliegue vuelve a avisar. Una vez visto que hay versión nueva no se vuelve atrás aunque, durante el reinicio, conteste un momento la antigua.
 *
 * Actualizar recarga la página. Si hay una junta de voz conectada, vuelve sola a ella al cargar (components/chat/JuntaProvider.tsx): ya no hace falta preguntar.
 */
export function AvisoDeVersion({ idInicial }: { idInicial: string }) {
  const [nueva, setNueva] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    const preguntar = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const r = await fetch('/api/version', { cache: 'no-store' })
        if (!r.ok) return
        const actual = idDeRespuesta(await r.json())
        let descartada: string | null = null
        try {
          descartada = window.localStorage.getItem(CLAVE_DESCARTADA)
        } catch {
          /* sin almacenamiento: se avisa sin más */
        }
        if (vivo && decidirAviso({ inicial: idInicial, actual, descartada }) === 'mostrar') setNueva(actual)
      } catch {
        /* sin red o el servidor reiniciando: se vuelve a preguntar luego */
      }
    }
    const t = setInterval(() => void preguntar(), PREGUNTAR_VERSION_CADA_MS)
    document.addEventListener('visibilitychange', preguntar)
    window.addEventListener('online', preguntar)
    return () => {
      vivo = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', preguntar)
      window.removeEventListener('online', preguntar)
    }
  }, [idInicial])

  if (!nueva) return null

  const actualizar = () => {
    window.location.reload()
  }
  const descartar = () => {
    try {
      window.localStorage.setItem(CLAVE_DESCARTADA, nueva)
    } catch {
      /* se quita solo para esta pestaña */
    }
    setNueva(null)
  }

  return (
    <div className="aviso-version" role="status" aria-live="polite">
      <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        <b>Nueva actualización disponible.</b> Actualiza el navegador para aplicarla.
      </span>
      <button type="button" className="aviso-version-actualizar" onClick={actualizar}>
        Actualizar
      </button>
      <button type="button" className="aviso-version-cerrar" onClick={descartar} aria-label="Cerrar este aviso hasta la próxima versión" title="Ahora no">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
