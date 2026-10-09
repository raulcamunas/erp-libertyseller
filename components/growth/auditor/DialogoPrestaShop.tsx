'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Loader2, X } from 'lucide-react'
import { Dialogo } from '@/components/plataforma/comun'
import { AVISO, BOTON, CAMPO, COLOR_ESTADO, TEXTO, TIPO } from '@/lib/estilo/denso'
import type { EstadoConexion } from '@/lib/prestashop/conexion'
import type { PruebaConexion } from '@/lib/prestashop/cliente'

/**
 * LA CONEXIÓN CON LA TIENDA PRESTASHOP DE SHOESF.
 *
 * Aquí se escribe la dirección de la tienda y la clave del Webservice. La clave
 * se manda al servidor, se cifra y NO VUELVE: el campo se queda vacío aunque haya
 * una guardada, y lo único que se enseña es que «hay una».
 *
 * «Probar conexión» llama a la tienda con lo guardado y dice qué ha encontrado:
 * si reconoce la clave, qué permisos tiene, cuántos registros de stock hay y qué
 * parte de las tallas tiene EAN, que es lo que permite cruzar con Amazon.
 */

async function llamar<T>(cuerpo: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/auditor-stock/prestashop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(json.error ?? `El servidor ha contestado ${res.status}`)
  return json
}

const n = (v: number) => v.toLocaleString('es-ES')

export function DialogoPrestaShop({ onCerrar }: { onCerrar: () => void }) {
  const [estado, setEstado] = useState<EstadoConexion | null>(null)
  const [url, setUrl] = useState('')
  const [clave, setClave] = useState('')
  const [trabajando, setTrabajando] = useState<null | 'guardando' | 'probando' | 'quitando'>(null)
  const [error, setError] = useState<string | null>(null)
  const [prueba, setPrueba] = useState<PruebaConexion | null>(null)

  useEffect(() => {
    let vigente = true
    ;(async () => {
      try {
        const r = await llamar<{ estado: EstadoConexion }>({ accion: 'estado' })
        if (!vigente) return
        setEstado(r.estado)
        setUrl(r.estado.url ?? '')
      } catch (e) {
        if (vigente) setError(e instanceof Error ? e.message : 'No se ha podido cargar')
      }
    })()
    return () => {
      vigente = false
    }
  }, [])

  async function guardar(): Promise<boolean> {
    setTrabajando('guardando')
    setError(null)
    setPrueba(null)
    try {
      const r = await llamar<{ estado: EstadoConexion }>({ accion: 'guardar', url, clave })
      setEstado(r.estado)
      setUrl(r.estado.url ?? url)
      // La clave se borra del campo en cuanto se ha guardado: ya no hace falta
      // tenerla en pantalla, y es lo que evita que acabe en una captura.
      setClave('')
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido guardar')
      return false
    } finally {
      setTrabajando(null)
    }
  }

  async function probar() {
    setTrabajando('probando')
    setError(null)
    setPrueba(null)
    try {
      const r = await llamar<{ prueba: PruebaConexion; estado: EstadoConexion }>({ accion: 'probar' })
      setPrueba(r.prueba)
      setEstado(r.estado)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido probar')
    } finally {
      setTrabajando(null)
    }
  }

  async function quitar() {
    setTrabajando('quitando')
    setError(null)
    try {
      const r = await llamar<{ estado: EstadoConexion }>({ accion: 'quitar' })
      setEstado(r.estado)
      setUrl('')
      setClave('')
      setPrueba(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido quitar')
    } finally {
      setTrabajando(null)
    }
  }

  /**
   * UN SOLO BOTÓN PARA CONECTAR.
   *
   * «Probar conexión» estaba apagado hasta guardar, porque la prueba usa lo
   * GUARDADO y no lo que hay escrito en el campo. Era correcto y un paso absurdo
   * para quien solo quiere conectar: había que adivinar que primero tocaba
   * «Guardar». Ahora, si hay algo escrito sin guardar, el botón principal lo
   * guarda y prueba a continuación; si no hay nada pendiente, solo prueba.
   */
  async function guardarYProbar() {
    if (hayCambios) {
      const bien = await guardar()
      if (!bien) return
    }
    await probar()
  }

  const ocupado = trabajando !== null
  const hayCambios =
    clave.trim() !== '' || !estado?.configurada || url.trim() !== (estado?.url ?? '')
  const puedeProbar = !ocupado && url.trim() !== '' && (clave.trim() !== '' || estado?.configurada === true)
  const puedeGuardar =
    !ocupado && url.trim() !== '' && (clave.trim() !== '' || estado?.configurada === true)

  return (
    <Dialogo
      titulo="Tienda PrestaShop de ShoesF"
      entradilla="Solo lectura: se usa para contrastar su stock con el de Amazon. La clave se guarda cifrada y no vuelve a verse."
      onCerrar={onCerrar}
      ancho="max-w-[640px]"
      pie={
        <>
          {estado?.configurada && (
            <button
              type="button"
              className={`${BOTON.base} ${BOTON.alto} ${BOTON.secundario} mr-auto`}
              disabled={ocupado}
              onClick={quitar}
            >
              Quitar conexión
            </button>
          )}
          <button type="button" className={`${BOTON.base} ${BOTON.alto} ${BOTON.secundario}`} onClick={onCerrar}>
            Cerrar
          </button>
          <button
            type="button"
            className={`${BOTON.base} ${BOTON.alto} ${BOTON.secundario}`}
            disabled={!puedeGuardar}
            onClick={guardar}
          >
            {trabajando === 'guardando' && <Loader2 className="h-3 w-3 animate-spin" />}
            Guardar
          </button>
          <button
            type="button"
            className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario}`}
            disabled={!puedeProbar}
            title={
              puedeProbar
                ? undefined
                : 'Escribe la dirección de la tienda y la clave del Webservice'
            }
            onClick={guardarYProbar}
          >
            {(trabajando === 'probando' || trabajando === 'guardando') && (
              <Loader2 className="h-3 w-3 animate-spin" />
            )}
            {hayCambios ? 'Guardar y probar' : 'Probar conexión'}
          </button>
        </>
      }
    >
      {estado && !estado.tabla && (
        <div className={`${AVISO.base} ${AVISO.conTono} mb-[10px]`} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
          <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.ambar }} />
          <div className={`${TIPO.s} ${TEXTO.t2}`}>
            Falta lanzar la migración <strong>221_prestashop_conexiones.sql</strong> en el editor SQL de
            Supabase: no hay dónde guardar la conexión.
          </div>
        </div>
      )}
      {estado && !estado.cifrado && (
        <div className={`${AVISO.base} ${AVISO.conTono} mb-[10px]`} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
          <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.ambar }} />
          <div className={`${TIPO.s} ${TEXTO.t2}`}>
            Este entorno no tiene clave de cifrado, así que no se puede guardar la clave aquí. En producción sí.
          </div>
        </div>
      )}

      <div className="grid gap-[10px]">
        <label className={CAMPO.contenedor}>
          <span className={CAMPO.etiqueta}>Dirección de la tienda</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.tu-tienda.com"
            className={CAMPO.input}
            disabled={ocupado}
            spellCheck={false}
          />
          <p className={CAMPO.nota}>
            La que ve un cliente al comprar, <strong>no la del panel de administración</strong>. Si pegas la del
            panel se queda solo con la tienda.
          </p>
        </label>

        <label className={CAMPO.contenedor}>
          <span className={CAMPO.etiqueta}>Clave del Webservice</span>
          <input
            type="password"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            placeholder={estado?.configurada ? 'Hay una guardada · escribe otra solo si quieres cambiarla' : 'Clave de 32 caracteres'}
            className={CAMPO.input}
            disabled={ocupado}
            autoComplete="off"
            spellCheck={false}
          />
          <p className={CAMPO.nota}>
            En su panel: <em>Parámetros avanzados → Webservice</em> → crear una clave con permiso de lectura
            (<strong>solo GET</strong>) sobre <code>stock_availables</code>, <code>combinations</code> y{' '}
            <code>products</code>. Nada más.
          </p>
        </label>

        {estado?.configurada && estado.ultimoTest && !prueba && (
          <p className={`${TIPO.s} ${estado.ultimoTest.ok ? TEXTO.t3 : ''}`} style={estado.ultimoTest.ok ? undefined : { color: COLOR_ESTADO.rojo }}>
            Última prueba ({new Date(estado.ultimoTest.at).toLocaleString('es-ES')}): {estado.ultimoTest.mensaje}
          </p>
        )}
      </div>

      {error && (
        <div className={`${AVISO.base} ${AVISO.conTono} mt-[10px]`} style={{ borderLeftColor: COLOR_ESTADO.rojo }}>
          <X className={AVISO.icono} style={{ color: COLOR_ESTADO.rojo }} />
          <div className={`${TIPO.s} ${TEXTO.t2}`}>{error}</div>
        </div>
      )}

      {prueba && (
        <div className="mt-[12px] grid gap-[8px]">
          <div
            className={`${AVISO.base} ${AVISO.conTono}`}
            style={{ borderLeftColor: prueba.ok ? COLOR_ESTADO.verde : COLOR_ESTADO.rojo }}
          >
            {prueba.ok ? (
              <Check className={AVISO.icono} style={{ color: COLOR_ESTADO.verde }} />
            ) : (
              <X className={AVISO.icono} style={{ color: COLOR_ESTADO.rojo }} />
            )}
            <div className={`${TIPO.s} ${TEXTO.t2}`}>
              <strong>{prueba.mensaje}</strong> <span className={TEXTO.t4}>({(prueba.ms / 1000).toFixed(1)} s)</span>
            </div>
          </div>

          <ul className={`${TIPO.s} ${TEXTO.t3} grid gap-[3px]`}>
            {prueba.recursos.map((r) => (
              <li key={r.nombre}>
                <span style={{ color: r.permitido ? COLOR_ESTADO.verde : COLOR_ESTADO.rojo }}>
                  {r.permitido ? '✓' : '✗'}
                </span>{' '}
                <code>{r.nombre}</code> {r.permitido ? 'se puede leer' : 'no se puede leer'}
              </li>
            ))}
          </ul>

          <p className={`${TIPO.s} ${TEXTO.t4}`}>
            La tienda lista {n(prueba.listadosEnRaiz.total)} recursos para esta clave
            {prueba.listadosEnRaiz.ejemplo.length > 0 && (
              <>
                {' '}
                (<code>{prueba.listadosEnRaiz.ejemplo.slice(0, 8).join(', ')}</code>
                {prueba.listadosEnRaiz.total > 8 ? '…' : ''})
              </>
            )}
            .
          </p>

          {prueba.stock && prueba.stock.muestra.length > 0 && (
            <div className={`${TIPO.s} ${TEXTO.t3}`}>
              <p className="mb-[3px]">
                Muestra de stock{prueba.stock.filas !== null ? ` (${n(prueba.stock.filas)} registros en total)` : ''}:
              </p>
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className={TEXTO.t4}>
                    <th className="text-left font-medium">Producto</th>
                    <th className="text-left font-medium">Talla</th>
                    <th className="text-right font-medium">Cantidad</th>
                  </tr>
                </thead>
                <tbody>
                  {prueba.stock.muestra.map((f, i) => (
                    <tr key={i}>
                      <td className="font-mono">{f.id_product}</td>
                      <td className="font-mono">{f.id_product_attribute === '0' ? '—' : f.id_product_attribute}</td>
                      <td className="text-right tabular-nums">{f.quantity === null ? '—' : n(f.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {prueba.avisos.map((a, i) => (
            <div key={i} className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
              <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.ambar }} />
              <div className={`${TIPO.s} ${TEXTO.t2}`}>{a}</div>
            </div>
          ))}
        </div>
      )}
    </Dialogo>
  )
}
