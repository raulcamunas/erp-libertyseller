'use client'

import { CalendarCheck, CalendarDays, FileBarChart2, Hourglass, Layers, RefreshCw, ShieldAlert, Sigma, TrendingUp } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Boton, EsqueletoTabla, EsqueletoTarjeta, EstadoVacio, FilaDeKpis, Kpi, haceCuanto } from '@/components/ui-ls'
import { EstadoDelProceso } from './EstadoDelProceso'
import { GraficoPorDia, GraficoPorHora } from './Graficos'
import { LogDeInformes } from './LogDeInformes'
import { RepartoPorComercial, TiraDeTurnos } from './TurnosYReparto'
import { decimal, diaConSemana, diaCorto, diasHasta, entero, etiquetaDeDia, type PanelDeInformes as Datos } from './tipos'

/**
 * EL PANEL «INFORMES» DE COLD CALLING (solo administradores): cómo va la recogida de informes de análisis (Keepa), sacado de lo ya hecho.
 *   · el proceso: si trabaja, por qué espera, el saldo de Keepa
 *   · las cifras: hoy, ayer, 7 días, total, en cola y cuándo se acaba al ritmo de ahora
 *   · el ritmo por día y por hora
 *   · el turno de comerciales y el reparto por comercial
 *   · el log de cada informe, con filtros
 * Lo pide a /api/cold-calling/informes al abrirse y cada minuto mientras se ve (la ruta vuelve a comprobar que quien pide es admin).
 */

const CADA_MS = 60_000

export function PanelDeInformes({ activa }: { activa: boolean }) {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState<{ codigo: number; texto: string } | null>(null)
  const [cargando, setCargando] = useState(false)
  const pidiendo = useRef(false)

  const pedir = useCallback(async () => {
    if (pidiendo.current) return
    pidiendo.current = true
    setCargando(true)
    try {
      const r = await fetch('/api/cold-calling/informes', { cache: 'no-store' })
      const j = await r.json().catch(() => null)
      if (!r.ok) {
        setError({ codigo: r.status, texto: (j as { error?: string } | null)?.error ?? `Error ${r.status}` })
        return
      }
      setDatos(j as Datos)
      setError(null)
    } catch {
      setError({ codigo: 0, texto: 'Sin conexión con el servidor' })
    } finally {
      pidiendo.current = false
      setCargando(false)
    }
  }, [])

  // Al abrirse y cada minuto, solo mientras se ve (pestaña visible y Cold Calling en primer plano)
  useEffect(() => {
    if (!activa) return
    const siVisible = () => {
      if (document.visibilityState === 'visible') void pedir()
    }
    siVisible()
    const reloj = setInterval(siVisible, CADA_MS)
    document.addEventListener('visibilitychange', siVisible)
    return () => {
      clearInterval(reloj)
      document.removeEventListener('visibilitychange', siVisible)
    }
  }, [activa, pedir])

  const contenedor = 'min-h-0 flex-1 overflow-y-auto overscroll-contain'

  if (error?.codigo === 403) {
    return (
      <div className={contenedor}>
        <EstadoVacio icono={ShieldAlert} titulo="Solo para administradores" descripcion="El panel de informes solo lo ven los administradores." />
      </div>
    )
  }

  if (!datos) {
    return (
      <div className={contenedor}>
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 pb-6">
          {error ? (
            <EstadoVacio icono={FileBarChart2} titulo="No se ha podido leer el panel" descripcion={error.texto} accion={{ texto: 'Reintentar', onClick: () => void pedir(), icono: RefreshCw }} />
          ) : (
            <>
              <EsqueletoTarjeta alto={220} />
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
                {Array.from({ length: 6 }, (_, i) => (
                  <EsqueletoTarjeta key={i} alto={110} />
                ))}
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <EsqueletoTarjeta alto={280} />
                <EsqueletoTarjeta alto={280} />
              </div>
              <EsqueletoTabla filas={8} columnas={6} />
            </>
          )}
        </div>
      </div>
    )
  }

  const ahora = Date.parse(datos.generadoAt)
  const c = datos.cifras
  const serie7 = datos.porDia.slice(-7).map((d) => d.amazon + d.sin)
  const finCinco = c.finEstimado.cinco
  const finAm = c.finEstimado.amazon

  return (
    <div className={contenedor}>
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 pb-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12.5px] text-[var(--ls-t3)]">
            Informes de análisis que se hacen solos para los leads. Desde el {c.primerInforme ? diaCorto(c.primerInforme) : '—'} · actualizado {haceCuanto(datos.generadoAt)}
            {error && <span className="text-[var(--ls-e-ambar)]"> · no se ha podido actualizar: {error.texto}</span>}
          </p>
          <Boton variante="secundario" tamano="sm" icono={RefreshCw} cargando={cargando} onClick={() => void pedir()}>
            Actualizar
          </Boton>
        </div>

        <EstadoDelProceso proceso={datos.proceso} saldo={datos.saldo} ahora={ahora} indice={0} />

        <FilaDeKpis minimo={170}>
          <Kpi
            indice={1}
            etiqueta="Hoy"
            icono={CalendarCheck}
            acento="marca"
            valor={c.hoy.total}
            anterior={c.ayerALaMismaHora}
            nota={`${entero(c.hoy.amazon)} Amazon · ${entero(c.hoy.sin)} sin · vs. ayer a esta hora`}
            serie={serie7}
          />
          <Kpi indice={2} etiqueta="Ayer" icono={CalendarDays} acento="marca" valor={c.ayer.total} nota={`${entero(c.ayer.amazon)} Amazon · ${entero(c.ayer.sin)} sin`} />
          <Kpi indice={3} etiqueta="Últimos 7 días" icono={TrendingUp} acento="marca" valor={c.ultimos7.total} nota={`${decimal(c.ritmoDia, 0)} al día · ${decimal(c.ritmoHora)} a la hora`} />
          <Kpi indice={4} etiqueta="Total hechos" icono={Sigma} acento="marca" valor={c.total.total} nota={`${entero(c.total.amazon)} Amazon · ${entero(c.total.sin)} sin · ${entero(c.saltados.total)} saltados`} />
          <Kpi indice={5} etiqueta="En cola" icono={Layers} acento="marca" valor={c.enCola.total} nota={`${entero(c.enCola.amazon)} Amazon · ${entero(c.enCola.sin)} sin · ${entero(c.enCola.deLosCinco)} del turno`} />
          <Kpi
            indice={6}
            etiqueta="Los del turno acaban en"
            icono={Hourglass}
            acento="marca"
            valor={diasHasta(finCinco, ahora)}
            formato={(n) => `${entero(n)} ${Math.round(n) === 1 ? 'día' : 'días'}`}
            nota={finCinco ? `${diaConSemana(finCinco)} · Amazon entera: ${finAm ? diaConSemana(finAm) : '—'}` : 'Sin ritmo todavía'}
          />
        </FilaDeKpis>

        <div className="grid gap-4 lg:grid-cols-2">
          <GraficoPorDia porDia={datos.porDia} ritmoDia={c.ritmoDia} indice={7} />
          <GraficoPorHora porHora={datos.porHora} ritmoHora={c.ritmoHora} indice={8} />
        </div>

        <TiraDeTurnos turno={datos.turno} indice={9} />
        <RepartoPorComercial comerciales={datos.comerciales} ahora={ahora} indice={10} />
        <LogDeInformes log={datos.log} indice={11} />

        <p className="text-center text-[11.5px] text-[var(--ls-t4)]">
          Los días van en hora de Madrid desde el {datos.porDia[0] ? etiquetaDeDia(datos.porDia[0].dia) : '—'}. Las fechas de fin son al ritmo de los últimos días completos y repartidas por turnos: orientativas.
          Los saltados de antes del 16 nov no tienen fecha.
        </p>
      </div>
    </div>
  )
}
