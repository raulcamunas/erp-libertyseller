'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { PANTALLA, TITULO } from '@/lib/estilo/denso'
import type { FilaFacturacion, Tablero } from '@/lib/facturacion/tipos'
import { Aviso, hoyISO, pedir } from './comun'
import { PanelFactura } from './PanelFactura'
import { PestanaCobros } from './PestanaCobros'
import { PestanaFacturar } from './PestanaFacturar'
import { PestanaPlantillas } from './PestanaPlantillas'
import { PestanaRegistro } from './PestanaRegistro'

/**
 * FACTURAR EL MES SIN ENTRAR EN ZOHO.
 *
 * Aquí viven las pestañas, lo que se lee de Zoho y la factura abierta; lo que se ve de cada pestaña está en su fichero.
 */

const PESTANAS = [
  { id: 'facturar', nombre: 'Facturar' },
  { id: 'cobros', nombre: 'Cobros y banco' },
  { id: 'plantillas', nombre: 'Plantillas' },
  { id: 'registro', nombre: 'Registro' },
] as const
type IdPestana = (typeof PESTANAS)[number]['id']

const mesActual = () => `${hoyISO().slice(0, 7)}-01`

type TableroConOrg = Tablero & { zohoOrgId: string | null }

const useEfectoDeDiseno = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/** La pestaña elegida la marca una pastilla que se desliza de una a otra */
function Pestanas({ activa, onElegir }: { activa: IdPestana; onElegir: (id: IdPestana) => void }) {
  const botones = useRef<Partial<Record<IdPestana, HTMLButtonElement | null>>>({})
  const [pastilla, setPastilla] = useState<{ izquierda: number; ancho: number } | null>(null)
  const [animar, setAnimar] = useState(false)

  useEfectoDeDiseno(() => {
    const medir = () => {
      const el = botones.current[activa]
      setPastilla(el ? { izquierda: el.offsetLeft, ancho: el.offsetWidth } : null)
    }
    medir()
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
  }, [activa])
  // La primera colocación no se anima: sería ver cómo la pastilla viaja desde la esquina
  useEffect(() => {
    const cuadro = requestAnimationFrame(() => setAnimar(true))
    return () => cancelAnimationFrame(cuadro)
  }, [])

  return (
    <div className="relative inline-flex items-center rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-0.5">
      <span
        aria-hidden
        className={`absolute bottom-0.5 top-0.5 rounded-[6px] border border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)] ${animar ? 'transition-[left,width] duration-300 ease-[cubic-bezier(0.22,0.8,0.3,1)]' : ''}`}
        style={{ left: pastilla?.izquierda ?? 0, width: pastilla?.ancho ?? 0, opacity: pastilla ? 1 : 0 }}
      />
      {PESTANAS.map((p) => (
        <button
          key={p.id}
          ref={(el) => {
            botones.current[p.id] = el
          }}
          type="button"
          aria-pressed={activa === p.id}
          onClick={() => onElegir(p.id)}
          className={`relative z-10 h-6 rounded-[6px] px-2.5 text-[11.5px] font-medium focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ls-acc-graf)] ${activa === p.id ? 'text-[var(--ls-t1)]' : 'text-[var(--ls-t3)] hover:text-[var(--ls-t1)]'}`}
        >
          {p.nombre}
        </button>
      ))}
    </div>
  )
}

export function CentroFacturacion() {
  const [pestana, setPestana] = useState<IdPestana>('facturar')
  const [period, setPeriod] = useState(mesActual)
  const [tablero, setTablero] = useState<TableroConOrg | null>(null)
  const [periodoLeido, setPeriodoLeido] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [abierta, setAbierta] = useState<FilaFacturacion | null>(null)
  const [facturaACobrar, setFacturaACobrar] = useState<string | null>(null)
  const [facturaARecordar, setFacturaARecordar] = useState<string | null>(null)

  // El aviso de la campana de una factura sin pagar trae «?pestana=cobros&recordar=<factura>»: se abre Cobros con su recordatorio
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const recordar = q.get('recordar')
    if (q.get('pestana') === 'cobros' || recordar) setPestana('cobros')
    if (recordar) setFacturaARecordar(recordar)
  }, [])

  const traer = useCallback(async () => {
    setCargando(true)
    try {
      setTablero(await pedir<TableroConOrg>(`/api/facturacion?period=${period}`))
      setPeriodoLeido(period)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido leer el mes')
    } finally {
      setCargando(false)
    }
  }, [period])

  useEffect(() => {
    void traer()
  }, [traer])

  return (
    <div className={`${PANTALLA.cuerpo} fac-zona`}>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className={TITULO.pantalla}>Facturación</h1>
        <Pestanas activa={pestana} onElegir={setPestana} />
      </div>

      {tablero && !tablero.zohoOk && (
        <Aviso tono="rojo" icono={AlertTriangle}>
          <span className="font-semibold">No se puede leer Zoho.</span> {tablero.errorZoho}
        </Aviso>
      )}
      {tablero?.faltaMigracion && (
        <Aviso tono="ambar" icono={AlertTriangle}>
          Falta lanzar la migración <span className="font-semibold">272</span>: sin ella no se guardan las parejas de clientes ni el registro.
        </Aviso>
      )}

      <div key={pestana} className={`${PANTALLA.cuerpo} rend-fundido`}>
        {pestana === 'facturar' && (
          <PestanaFacturar
            tablero={tablero}
            periodoLeido={periodoLeido}
            cargando={cargando}
            error={error}
            period={period}
            onCambiarMes={setPeriod}
            onActualizar={traer}
            onAbrir={setAbierta}
            onCobrar={(id) => {
              setFacturaACobrar(id)
              setPestana('cobros')
            }}
          />
        )}
        {pestana === 'cobros' && <PestanaCobros zohoOrgId={tablero?.zohoOrgId ?? null} facturaInicial={facturaACobrar} recordarInicial={facturaARecordar} onCambio={() => void traer()} />}
        {pestana === 'plantillas' && <PestanaPlantillas />}
        {pestana === 'registro' && <PestanaRegistro />}
      </div>

      {abierta && (
        <PanelFactura
          fila={abierta}
          period={period}
          contactos={tablero?.contactos ?? []}
          zohoOrgId={tablero?.zohoOrgId ?? null}
          onCerrar={() => setAbierta(null)}
          onCambio={() => void traer()}
          onCobrar={(id) => {
            setAbierta(null)
            setFacturaACobrar(id)
            setPestana('cobros')
          }}
        />
      )}
    </div>
  )
}
