'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Bot, DatabaseZap, RefreshCw } from 'lucide-react'
import { Boton, EstadoVacio, EsqueletoTarjeta } from '@/components/ui-ls'
import { FALTA_MIGRACION_315, type PanelDelAgente } from '@/lib/ads/agente/tipos'
import { llamar } from './llamar'
import { haceCuanto } from './formato'
import { ErrorDeAccion, TarjetaDeEstado, type Accion } from './agente/TarjetaDeEstado'
import { TarjetaDeObjetivos } from './agente/TarjetaDeObjetivos'
import { TarjetaDeRitmo } from './agente/TarjetaDeRitmo'
import { LineaDelAgente } from './agente/LineaDelAgente'
import { TarjetaDeIa } from './agente/TarjetaDeIa'
import { TopesDelAgente } from './agente/TopesDelAgente'

const RUTA = '/api/ads/cuenta/agente'
const REFRESCO_MS = 60_000

/**
 * PESTAÑA «AGENTE» DE MARKETING TEST: el agente PPC de esta cuenta (estado, objetivos, ritmo de gasto, lo que ha hecho, la IA y los topes). Todo sale de GET /api/ads/cuenta/agente
 * (PanelDelAgente) y se relee cada minuto mientras la pestaña se ve; las acciones van por PUT/POST y siempre con confirmación. Lo que es de administrador solo se pinta si lo eres
 * (y el servidor lo vuelve a comprobar).
 */
export function PestanaAgente({ perfilId, moneda, irA }: { perfilId: string; moneda: string | null; irA: (pestana: string) => void }) {
  const [panel, setPanel] = useState<PanelDelAgente | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [leidoEn, setLeidoEn] = useState<number | null>(null)
  const vivo = useRef(true)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const d = await llamar<PanelDelAgente>(`${RUTA}?perfilId=${encodeURIComponent(perfilId)}`)
      if (!vivo.current) return
      setPanel(d)
      setError(null)
      setLeidoEn(Date.now())
    } catch (e) {
      if (vivo.current) setError(e instanceof Error ? e.message : 'No se ha podido cargar el agente.')
    } finally {
      if (vivo.current) setCargando(false)
    }
  }, [perfilId])

  // Al entrar, cada 60 s mientras la pestaña del navegador se ve, y al volver a ella si hace más de un minuto
  useEffect(() => {
    vivo.current = true
    void cargar()
    let ultima = Date.now()
    const tic = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      ultima = Date.now()
      void cargar()
    }, REFRESCO_MS)
    const alCambiar = () => {
      if (document.visibilityState === 'visible' && Date.now() - ultima > REFRESCO_MS) {
        ultima = Date.now()
        void cargar()
      }
    }
    document.addEventListener('visibilitychange', alCambiar)
    return () => {
      vivo.current = false
      window.clearInterval(tic)
      document.removeEventListener('visibilitychange', alCambiar)
    }
  }, [cargar])

  /** PUT/POST a la API del agente. Lanza ErrorDeAccion (con el código HTTP) para que la Confirmacion no se cierre y reanudar pueda leer el 409 */
  const accion: Accion = useCallback(
    async (metodo, cuerpo, opciones) => {
      let res: Response
      try {
        res = await fetch(RUTA, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ perfilId, ...cuerpo }), cache: 'no-store' })
      } catch {
        const texto = 'No hay conexión con el servidor. Vuelve a intentarlo.'
        toast.error(texto)
        throw new ErrorDeAccion(texto, 0)
      }
      const datos = (await res.json().catch(() => null)) as { error?: string; mensaje?: string } | null
      if (!res.ok) {
        const texto = datos?.error ?? `Error ${res.status}`
        if (!(opciones?.callar409 && res.status === 409)) toast.error(texto)
        throw new ErrorDeAccion(texto, res.status)
      }
      toast.success(datos?.mensaje ?? opciones?.exito ?? 'Hecho.')
      await cargar()
    },
    [perfilId, cargar],
  )

  if (!panel) {
    return error ? (
      <EstadoVacio icono={Bot} acento="marketing" titulo="No se ha podido cargar el agente" descripcion={error} accion={{ texto: 'Reintentar', icono: RefreshCw, onClick: () => void cargar() }} />
    ) : (
      <div className="grid gap-4 lg:grid-cols-2" aria-busy>
        <EsqueletoTarjeta className="lg:col-span-2" />
        <EsqueletoTarjeta />
        <EsqueletoTarjeta />
      </div>
    )
  }

  if (panel.faltaMigracion != null) {
    return (
      <EstadoVacio
        icono={DatabaseZap}
        acento="marketing"
        titulo={panel.faltaMigracion === 315 ? FALTA_MIGRACION_315 : `Falta lanzar la migración ${panel.faltaMigracion} en Supabase.`}
        descripcion="El agente PPC guarda su estado, sus topes y lo que hace en tablas nuevas. Hasta que se lance, esta pestaña no puede enseñar nada y el agente no se puede encender."
        accion={{ texto: 'Volver a mirar', icono: RefreshCw, onClick: () => void cargar() }}
      />
    )
  }

  const encendido = (panel.config?.estado ?? 'apagado') !== 'apagado'

  return (
    <div className="flex min-w-0 flex-col gap-4 pb-28">
      {error && (
        <p className="text-[12px] text-[var(--ls-t3)]" role="status">
          No se ha podido releer ({error}); lo que ves es de {leidoEn ? haceCuanto(leidoEn) : 'antes'}.
        </p>
      )}

      <TarjetaDeEstado panel={panel} accion={accion} irA={irA} />

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <div className="min-w-0 lg:col-span-2">
          <TarjetaDeObjetivos panel={panel} moneda={moneda ?? panel.moneda} accion={accion} irA={irA} />
        </div>
        {encendido && (
          <div className="min-w-0 lg:col-span-2">
            <TarjetaDeRitmo panel={panel} moneda={moneda ?? panel.moneda} />
          </div>
        )}
        <div className="min-w-0">
          <LineaDelAgente linea={panel.linea} accion={accion} />
        </div>
        <div className="min-w-0">
          <TarjetaDeIa panel={panel} accion={accion} />
        </div>
        {panel.esAdmin && (
          <div className="min-w-0 lg:col-span-2">
            <TopesDelAgente panel={panel} moneda={moneda ?? panel.moneda} accion={accion} />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--ls-t4)]">
        <Boton variante="fantasma" tamano="sm" icono={RefreshCw} cargando={cargando} onClick={() => void cargar()}>
          Actualizar
        </Boton>
        {leidoEn && <span>Datos {haceCuanto(leidoEn)} · se releen solos cada minuto</span>}
      </div>
    </div>
  )
}
