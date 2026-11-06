'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { BOTON, PANTALLA, TITULO } from '@/lib/estilo/denso'
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

export function CentroFacturacion() {
  const [pestana, setPestana] = useState<IdPestana>('facturar')
  const [period, setPeriod] = useState(mesActual)
  const [tablero, setTablero] = useState<TableroConOrg | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [abierta, setAbierta] = useState<FilaFacturacion | null>(null)
  const [facturaACobrar, setFacturaACobrar] = useState<string | null>(null)

  const traer = useCallback(async () => {
    setCargando(true)
    try {
      setTablero(await pedir<TableroConOrg>(`/api/facturacion?period=${period}`))
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
    <div className={PANTALLA.cuerpo}>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className={TITULO.pantalla}>Facturación</h1>
        <div className="flex items-center gap-1">
          {PESTANAS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPestana(p.id)}
              className={`${BOTON.chip} ${pestana === p.id ? BOTON.chipEncendido : ''}`}
            >
              {p.nombre}
            </button>
          ))}
        </div>
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

      {pestana === 'facturar' && (
        <PestanaFacturar
          tablero={tablero}
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
      {pestana === 'cobros' && <PestanaCobros zohoOrgId={tablero?.zohoOrgId ?? null} facturaInicial={facturaACobrar} onCambio={() => void traer()} />}
      {pestana === 'plantillas' && <PestanaPlantillas />}
      {pestana === 'registro' && <PestanaRegistro />}

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
