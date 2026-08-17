'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Copy, Loader2, Play } from 'lucide-react'
import { postAmazon } from '@/lib/amazon/client'
import { esProducto, type ProductoEntrais } from '@/lib/entrais/api'
import { TablaProductos } from './TablaProductos'

/**
 * ENTRAIS TEST · VER QUÉ TRAE LA API DEL PROVEEDOR.
 *
 * Un cliente compra a este proveedor y nos han dado acceso a su API para sacar
 * productos, precios y stock. Esto es el paso previo a decidir nada: se llama,
 * se mira el JSON y ya.
 *
 * NO SE GUARDA NADA todavía, y es deliberado. Con el dato delante se decide qué
 * merece la pena guardar; al revés se acaba con una tabla de treinta columnas de
 * las que se usan cuatro.
 */

interface Llamada {
  id: string
  nombre: string
  para: string
  ruta: string
  /** true si puede tardar y traer mucho */
  pesada?: boolean
}

const LLAMADAS: Llamada[] = [
  {
    id: 'productos',
    nombre: 'Todos los productos',
    para: 'Código, descripción, EAN, marca, familia, PRECIO y stock de cada artículo activo',
    ruta: '/api/v1/Products',
    pesada: true,
  },
  {
    id: 'producto',
    nombre: 'Un producto',
    para: 'El detalle de un artículo. Cambia el código del final',
    ruta: '/api/v1/Product/1',
  },
  {
    id: 'pedidos',
    nombre: 'Pedidos y albaranes',
    para: 'Las reservas y albaranes del cliente',
    ruta: '/api/v1/Orders',
  },
  {
    id: 'facturas',
    nombre: 'Facturas',
    para: 'El listado de facturas',
    ruta: '/api/v1/Invoices',
  },
  {
    id: 'rmas',
    nombre: 'RMAs abiertos',
    para: 'Las devoluciones en curso',
    ruta: '/api/v1/Rmas',
  },
  {
    id: 'agencias',
    nombre: 'Agencias de envío',
    para: 'Con qué transportistas trabaja',
    ruta: '/api/v1/ShippingAgencys',
  },
  {
    id: 'codigos',
    nombre: 'Códigos de error',
    para: 'Su tabla de errores en castellano. Útil para traducir lo que devuelva',
    ruta: '/api/v1/GetAllCodes/es',
  },
]

export function EntraisTest() {
  const [entorno, setEntorno] = useState<'pruebas' | 'real'>('pruebas')
  const [ruta, setRuta] = useState(LLAMADAS[0].ruta)
  const [cargando, setCargando] = useState(false)
  const [salida, setSalida] = useState('')
  const [meta, setMeta] = useState('')
  const [datos, setDatos] = useState<unknown>(null)
  const [vista, setVista] = useState<'tabla' | 'json'>('tabla')

  /**
   * Los productos, si es que la respuesta lo son.
   *
   * Vale igual para `/Products` —una lista— que para `/Product/38265`, que
   * devuelve el objeto suelto: se envuelve y se pinta la tabla de una fila. Y si
   * lo que ha llegado son facturas o RMAs, esto queda vacío y solo se ofrece el
   * JSON, que es lo honesto: una tabla de SKU y stock sobre una factura no
   * significa nada.
   */
  const productos = useMemo<ProductoEntrais[]>(() => {
    if (Array.isArray(datos)) return datos.filter(esProducto)
    return esProducto(datos) ? [datos] : []
  }, [datos])

  async function lanzar(forzar = false) {
    setCargando(true)
    setSalida('')
    setMeta('')
    setDatos(null)

    const res = await postAmazon<{
      entorno: string
      ms: number
      cuantos: number | null
      deCache: boolean
      edadMs: number
      cuota: { limite: number; usadas: number; quedan: number; seLiberaEn: string | null } | null
      datos: unknown
    }>('/api/entrais/probar', { entorno, ruta, forzar })

    setCargando(false)

    if (!res.ok) {
      setSalida(res.error)
      setMeta('falló')
      return
    }
    /**
     * DE DÓNDE SALE EL DATO Y CUÁNTAS LLAMADAS QUEDAN, siempre.
     *
     * Entrais admite cuatro llamadas por hora al catálogo. Sin esto, cuatro
     * clics aquí dejan sin cuota al ciclo de stock durante el resto de la hora
     * y nadie se entera hasta que falla una ejecución automática.
     */
    setMeta(
      `${res.data.entorno} · ${res.data.ms} ms` +
        (res.data.cuantos !== null
          ? ` · ${res.data.cuantos.toLocaleString('es-ES')} elementos`
          : '') +
        (res.data.deCache
          ? ` · de la caché (hace ${Math.max(1, Math.round(res.data.edadMs / 60_000))} min)`
          : '') +
        (res.data.cuota
          ? ` · quedan ${res.data.cuota.quedan}/${res.data.cuota.limite} llamadas de esta hora`
          : '')
    )
    setDatos(res.data.datos)
    setSalida(JSON.stringify(res.data.datos, null, 2))
    setVista('tabla')
  }

  return (
    <div className="space-y-3 pb-6">
      <div>
        <h1 className="text-[22px] font-semibold text-white">Entrais Test</h1>
        <p className="text-[12px] text-white/45 mt-0.5">
          La API del proveedor de un cliente. De momento solo se mira qué devuelve: nada se guarda.
        </p>
      </div>

      {/* EL ENTORNO, ARRIBA DEL TODO Y CON EL REAL EN ROJO.
          Son dos servidores con dos contraseñas distintas, y el real es el del
          cliente de verdad. Que se vea de un vistazo cuál está seleccionado es
          más importante que cualquier otra cosa de esta pantalla. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            { id: 'pruebas' as const, texto: 'Pruebas', pista: 'Puerto 5003 · datos de prueba' },
            { id: 'real' as const, texto: 'Real', pista: 'Puerto 5002 · la cuenta de verdad' },
          ]
        ).map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => setEntorno(e.id)}
            title={e.pista}
            className={`px-3 py-1.5 rounded-full border text-[12px] font-medium transition-colors ${
              entorno === e.id
                ? e.id === 'real'
                  ? 'border-red-500/60 bg-red-500/15 text-red-200'
                  : 'border-[#FF6600]/60 bg-[#FF6600]/15 text-white'
                : 'border-white/10 text-white/45 hover:text-white/80'
            }`}
          >
            {e.texto}
          </button>
        ))}

        {entorno === 'real' && (
          <span className="text-[11px] text-red-300/80 flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3" />
            Estás contra el entorno de producción del proveedor. Solo se leen datos.
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {LLAMADAS.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setRuta(l.ruta)}
            title={l.para}
            className={`px-2.5 py-1 rounded-full border text-[11px] font-medium transition-colors ${
              ruta === l.ruta
                ? 'border-[#FF6600]/60 bg-[#FF6600]/15 text-white'
                : 'border-white/10 text-white/45 hover:text-white/80'
            }`}
          >
            {l.nombre}
            {l.pesada && <span className="text-white/30"> ·  puede tardar</span>}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={ruta}
          onChange={(e) => setRuta(e.target.value)}
          placeholder="/api/v1/Products"
          className="flex-1 min-w-[280px] h-7 rounded-lg border border-white/10 bg-white/[0.03] px-2 text-[11px] text-white font-mono outline-none focus:border-[#FF6600]"
        />
        <button
          type="button"
          onClick={() => void lanzar(false)}
          disabled={cargando}
          className="px-3 py-1.5 rounded-full bg-[#FF6600] text-white text-[11px] font-medium flex items-center gap-1.5 disabled:opacity-50"
        >
          {cargando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Lanzar
        </button>
        {/* Saltarse la caché es una decisión, no el comportamiento por defecto:
            gasta una de las cuatro llamadas que hay por hora. */}
        <button
          type="button"
          onClick={() => void lanzar(true)}
          disabled={cargando}
          className="px-3 py-1.5 rounded-full border border-white/15 text-white/60 hover:text-white text-[11px] font-medium disabled:opacity-50 transition-colors"
          title="Ignora la caché y llama a Entrais de verdad. Gasta una de las 4 llamadas por hora"
        >
          Forzar lectura
        </button>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-white/35">Respuesta</span>
        {meta && <span className="text-[10px] text-white/40">{meta}</span>}

        {/* La tabla solo se ofrece cuando lo que ha llegado son productos. Con
            una respuesta de facturas o de RMAs el botón ni aparece, en vez de
            enseñar una tabla de cinco columnas vacías. */}
        {productos.length > 0 && (
          <div className="flex gap-1">
            {(['tabla', 'json'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVista(v)}
                className={`px-2 py-0.5 rounded-full border text-[10px] font-medium transition-colors ${
                  vista === v
                    ? 'border-[#FF6600]/60 bg-[#FF6600]/15 text-white'
                    : 'border-white/10 text-white/40 hover:text-white/80'
                }`}
              >
                {v === 'tabla' ? 'Tabla' : 'JSON'}
              </button>
            ))}
          </div>
        )}

        {salida && (
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(salida)
              toast.success('Copiado')
            }}
            className="ml-auto text-white/40 hover:text-white transition-colors"
            title="Copiar el JSON"
          >
            <Copy className="h-3 w-3" />
          </button>
        )}
      </div>

      {productos.length > 0 && vista === 'tabla' ? (
        <TablaProductos productos={productos} />
      ) : (
        <pre className="h-[520px] overflow-auto rounded-lg border border-white/10 bg-black/40 p-2 text-[10.5px] text-white/70 font-mono whitespace-pre">
          {salida || 'Elige una llamada y dale a Lanzar.'}
        </pre>
      )}

      <p className="text-[10px] text-white/30">
        Solo lectura. Su API tiene también una llamada para crear reservas de pedido, y desde aquí
        no se puede usar: eso mueve mercancía de un cliente y tendrá su propia pantalla con
        confirmación y registro.
      </p>
      <p className="text-[10px] text-amber-300/50">
        Entrais solo admite <strong>4 llamadas por hora</strong> a «Todos los productos», y esas
        cuatro son las mismas que usa el ciclo de stock. Por eso «Lanzar» sirve lo de hace menos de
        veinte minutos sin llamar a nadie: si gastas las cuatro aquí, el envío automático de stock
        se queda sin ninguna hasta la hora siguiente.
      </p>
    </div>
  )
}
