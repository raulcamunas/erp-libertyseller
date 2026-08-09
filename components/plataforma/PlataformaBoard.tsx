'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Link2Off, RefreshCw, Users } from 'lucide-react'
import { toast } from 'sonner'
import { getAmazon } from '@/lib/amazon/client'
import type { ClienteConIngesta, ClientesRespuesta } from '@/lib/plataforma/cliente'
import { BOTON, CAMPO, INSIGNIA, PANTALLA, TEXTO, TIPO } from '@/lib/estilo/denso'
import { PARAM_PESTANA } from '@/components/amazon-api/pestanas'
import { Aviso, Cargando, Vacio } from './comun'
import { FichaSku } from './FichaSku'
import { PanelCobertura } from './PanelCobertura'
import { PanelIngesta } from './PanelIngesta'
import { PanelSeguimiento } from './PanelSeguimiento'

/**
 * LA PANTALLA DEL MÓDULO A1.
 *
 * Cuatro vistas de una sola cosa: la capa de datos sobre la que se van a montar
 * A2 (Buy Box), A3 (auditoría de repricing), A4 (FBM→FBA) y A5 (costes).
 *
 *   · INGESTA     — qué trabajos hay, en qué van, cuándo fue el último barrido
 *                   completo y el último diario, qué falló y por qué.
 *   · COBERTURA   — de los SKU de este cliente, cuántos tienen cada dato. Es la
 *                   pantalla que dice si el resto de módulos se pueden fiar.
 *   · SEGUIMIENTO — el criterio de «SKU activo» y la tabla de SKU, editable.
 *   · FICHA       — un SKU y sus series, en un diálogo, porque se abre desde las
 *                   otras dos y volver atrás no puede costar recargar la tabla.
 *
 *
 * ============ POR QUÉ TODO CUELGA DE UN SELECTOR DE CLIENTE ============
 *
 * No es una preferencia de diseño: es el compromiso firmado ante Amazon. Los
 * datos de un vendedor se usan exclusivamente para operar y asesorar la cuenta
 * de ESE vendedor, así que no hay ni una vista que mezcle catálogos, ni una
 * media del conjunto, ni una comparativa. La única lista que enseña varios
 * clientes a la vez —la de abajo— muestra métricas de NUESTRO proceso (trabajos
 * en cola, incidencias abiertas) de cada uno POR SEPARADO, que es exactamente lo
 * que el compromiso permite, y va en orden alfabético para que ni el orden sea
 * un ranking.
 *
 * Si algún día hace falta «comparar la cobertura de los dieciséis», eso no se
 * hace aquí ni en ningún sitio: hay que pararse y decirlo.
 */

type Pestana = 'ingesta' | 'cobertura' | 'seguimiento'

const PESTANAS: Array<{ id: Pestana; nombre: string }> = [
  { id: 'ingesta', nombre: 'Ingesta' },
  { id: 'cobertura', nombre: 'Cobertura' },
  { id: 'seguimiento', nombre: 'Seguimiento' },
]

/** El SKU que está abierto en la ficha */
export interface SkuAbierto {
  connectionId: string
  marketplaceId: string
  sku: string
}

export function PlataformaBoard() {
  const [clientes, setClientes] = useState<ClienteConIngesta[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [clienteId, setClienteId] = useState<string | null>(null)
  const [pestana, setPestana] = useState<Pestana>('ingesta')
  const [sku, setSku] = useState<SkuAbierto | null>(null)
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(
    async (silencioso = false) => {
      if (!silencioso) setCargando(true)
      const res = await getAmazon<ClientesRespuesta>('/api/plataforma/clientes')
      setCargando(false)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setError(null)
      setClientes(res.data.clientes)
      // Se elige el primero solo la PRIMERA vez. Volver a elegirlo en cada
      // refresco tiraría al usuario de vuelta al cliente uno cada vez que la
      // pantalla se recarga sola, que es la clase de fallo que se nota tarde.
      setClienteId((actual) => {
        if (actual && res.data.clientes.some((c) => c.id === actual)) return actual
        return res.data.clientes[0]?.id ?? null
      })
    },
    []
  )

  useEffect(() => {
    void cargar()
  }, [cargar])

  const cliente = useMemo(
    () => clientes?.find((c) => c.id === clienteId) ?? null,
    [clientes, clienteId]
  )

  if (cargando && !clientes) return <Cargando texto="Leyendo los clientes…" />

  if (error) {
    return (
      <Aviso tono="rojo" icono={AlertTriangle}>
        {error}
      </Aviso>
    )
  }

  if (!clientes || clientes.length === 0) {
    return (
      <Vacio
        icono={<Users />}
        titulo="Todavía no hay ningún cliente dado de alta"
        accion={
          <a
            href={`/dashboard/amazon-api?${PARAM_PESTANA}=cuentas`}
            className={`${BOTON.base} ${BOTON.secundario}`}
          >
            Ir a Cuentas
          </a>
        }
      >
        Se dan de alta en la pestaña <span className={TEXTO.t1}>Cuentas</span>.
      </Vacio>
    )
  }

  return (
    <div className={`${PANTALLA.cuerpo} h-full`}>
      {/* -------- Barra: cliente, pestañas, refrescar -------- */}
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <label className="flex items-center gap-[6px] min-w-0">
          <span className={`${TIPO.xs} ${TEXTO.t4} shrink-0`}>Cliente</span>
          <select
            value={clienteId ?? ''}
            onChange={(e) => {
              setClienteId(e.target.value)
              setSku(null)
            }}
            className={`${CAMPO.input} max-w-[240px]`}
          >
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.conexiones.length === 0 ? ' — sin cuenta conectada' : ''}
              </option>
            ))}
          </select>
        </label>

        <div className={PANTALLA.separador} />

        <nav className="flex items-center gap-[4px]" role="tablist">
          {PESTANAS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={pestana === p.id}
              onClick={() => setPestana(p.id)}
              className={`${BOTON.chip} ${pestana === p.id ? BOTON.chipEncendido : ''}`}
            >
              {p.nombre}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-[6px]">
          {cliente && (cliente.eventos_graves_abiertos > 0 || cliente.errores_24h > 0) && (
            <span className={INSIGNIA.base} title="Incidencias graves abiertas de este cliente">
              <AlertTriangle
                className={INSIGNIA.icono}
                style={{ color: 'var(--ls-e-rojo)' }}
              />
              {cliente.eventos_graves_abiertos > 0
                ? `${cliente.eventos_graves_abiertos} sin resolver`
                : `${cliente.errores_24h} fallos hoy`}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              void cargar(true).then(() => toast.success('Actualizado'))
            }}
            className={`${BOTON.base} ${BOTON.secundario}`}
          >
            <RefreshCw className="h-3 w-3" />
            Actualizar
          </button>
        </div>
      </div>

      {/* -------- El cliente elegido, sin cuenta conectada -------- */}
      {cliente && cliente.conexiones.length === 0 ? (
        // El destino, corto y CORRECTO: esta pantalla ya está DENTRO de Amazon
        // API, así que mandar «al módulo Amazon API» era dar vueltas. El porqué
        // —qué es el consentimiento y qué pasa hasta que llega— está en el botón
        // de información, que es su sitio.
        <Vacio
          icono={<Link2Off />}
          titulo={`${cliente.name} no tiene ninguna cuenta de Amazon conectada`}
          accion={
            <a
              href={`/dashboard/amazon-api?${PARAM_PESTANA}=cuentas`}
              className={`${BOTON.base} ${BOTON.secundario}`}
            >
              Conectarla en Cuentas
            </a>
          }
        >
          Se conecta en la pestaña <span className={TEXTO.t1}>Cuentas</span>.
        </Vacio>
      ) : (
        cliente && (
          <div className="flex-1 min-h-0 min-w-0 overflow-auto">
            {pestana === 'ingesta' && (
              <PanelIngesta
                cliente={cliente}
                clientes={clientes}
                onElegirCliente={(id) => {
                  setClienteId(id)
                  setSku(null)
                }}
                onCambio={() => void cargar(true)}
              />
            )}
            {pestana === 'cobertura' && <PanelCobertura cliente={cliente} onAbrirSku={setSku} />}
            {pestana === 'seguimiento' && (
              <PanelSeguimiento cliente={cliente} onAbrirSku={setSku} />
            )}
          </div>
        )
      )}

      {sku && cliente && (
        <FichaSku cliente={cliente} abierto={sku} onCerrar={() => setSku(null)} />
      )}
    </div>
  )
}

