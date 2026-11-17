'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Copy, Landmark, Link2, MessageCircle, X } from 'lucide-react'
import { BOTON, COLOR_ESTADO, TABLA, TEXTO, TIPO } from '@/lib/estilo/denso'
import { NOMBRE_DEL_TIPO, type TipoDeCuenta } from '@/lib/empleados/datos-de-pago'

interface Fila {
  employeeId: string
  nombre: string
  activo: boolean
  datos: { tipo: TipoDeCuenta; titular: string; banco: string; paisBanco: string; moneda: string; cuenta: string; enviado: string } | null
  enlace: { ruta: string; caduca: string; aperturas: number } | null
}

const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })

const mensaje = (nombre: string, url: string) =>
  `Hola ${nombre.split(' ')[0]}. Para hacerte los pagos necesito tus datos bancarios. Rellénalos aquí, tal y como aparecen en tu banco (te lleva 2 minutos):\n\n${url}\n\nEl enlace es solo para ti, sirve una vez y caduca en 7 días. Nunca te pediremos contraseñas ni códigos.`

/**
 * DATOS DE PAGO DEL EQUIPO (solo administradores). De cada persona: si ya ha enviado sus datos (banco y las 4 últimas cifras, nunca la cuenta entera)
 * y su enlace para pedírselos, con el mensaje de WhatsApp ya escrito.
 */
export function DatosDePagoEquipo() {
  const [abierto, setAbierto] = useState(false)
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [copiado, setCopiado] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/employees/datos-de-pago', { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'No se ha podido leer')
      setFilas(j.equipo)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    if (abierto) void cargar()
  }, [abierto, cargar])

  async function copiar(f: Fila, ruta: string, conMensaje: boolean) {
    const url = `${window.location.origin}${ruta}`
    try {
      await navigator.clipboard.writeText(conMensaje ? mensaje(f.nombre, url) : url)
      setCopiado(`${f.employeeId}-${conMensaje ? 'm' : 'u'}`)
      setTimeout(() => setCopiado(null), 2000)
    } catch {
      window.prompt('Cópialo:', conMensaje ? mensaje(f.nombre, url) : url)
    }
  }

  async function generar(f: Fila) {
    if (f.datos && !window.confirm(`${f.nombre} ya envió sus datos. Si genera otro enlace y lo rellena, sustituirá a los actuales. ¿Seguimos?`)) return
    setOcupado(f.employeeId)
    try {
      const res = await fetch('/api/employees/datos-de-pago', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employeeId: f.employeeId }) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'No se ha podido crear')
      await copiar(f, j.ruta, true)
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setOcupado(null)
    }
  }

  const visibles = (filas ?? []).filter((f) => f.activo || f.datos)
  const conDatos = visibles.filter((f) => f.datos).length

  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} className={`${BOTON.base} ${BOTON.alto} ${BOTON.secundario}`}>
        <Landmark className="h-[14px] w-[14px]" />
        Datos de pago
      </button>
      {abierto && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setAbierto(false)}>
          <div className="max-h-[85vh] w-full max-w-[860px] overflow-auto rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center gap-2">
              <h2 className={`${TIPO.l} ${TEXTO.t1}`}>Datos de pago del equipo</h2>
              {filas && <span className={`${TIPO.s} ${TEXTO.t3}`}>· {conDatos} de {visibles.length} los tienen</span>}
              <button type="button" onClick={() => setAbierto(false)} className={`ml-auto ${BOTON.icono}`} aria-label="Cerrar">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className={`${TIPO.s} ${TEXTO.t3} mb-3`}>
              «Pedir datos» crea un enlace de un solo uso (7 días) y copia el mensaje para WhatsApp. La persona lo rellena desde el móvil y te llega un aviso. Aquí solo se ve el banco y las 4 últimas cifras.
            </p>
            {error && <p className={`${TIPO.s} mb-2`} style={{ color: COLOR_ESTADO.rojo }}>{error}</p>}
            {!filas ? (
              <p className={`${TIPO.s} ${TEXTO.t3}`}>Cargando…</p>
            ) : (
              <table className={TABLA.tabla}>
                <thead>
                  <tr>
                    <th className={TABLA.cabecera}>Persona</th>
                    <th className={TABLA.cabecera}>Datos</th>
                    <th className={TABLA.cabecera}>Enlace</th>
                    <th className={TABLA.cabecera} />
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((f) => (
                    <tr key={f.employeeId} className={TABLA.fila}>
                      <td className={TABLA.celda}>
                        <span className={TEXTO.t1}>{f.nombre}</span>
                      </td>
                      <td className={`${TABLA.celda} whitespace-normal`}>
                        {f.datos ? (
                          <span className="inline-flex items-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5" style={{ color: COLOR_ESTADO.verde }} />
                            {f.datos.banco} {f.datos.cuenta} · {NOMBRE_DEL_TIPO[f.datos.tipo]} · {f.datos.moneda}
                            <span className={TEXTO.t3}> · {fecha(f.datos.enviado)}</span>
                          </span>
                        ) : (
                          <span style={{ color: COLOR_ESTADO.ambar }}>Sin datos</span>
                        )}
                      </td>
                      <td className={TABLA.celda}>
                        {f.enlace ? (
                          <span className={TEXTO.t3}>
                            caduca el {fecha(f.enlace.caduca)} · {f.enlace.aperturas ? `abierto ${f.enlace.aperturas} ${f.enlace.aperturas === 1 ? 'vez' : 'veces'}` : 'sin abrir'}
                          </span>
                        ) : (
                          <span className={TEXTO.t4}>—</span>
                        )}
                      </td>
                      <td className={`${TABLA.celda} text-right`}>
                        <span className="inline-flex gap-1">
                          {f.enlace && (
                            <>
                              <button type="button" onClick={() => void copiar(f, f.enlace!.ruta, true)} className={`${BOTON.base} ${BOTON.secundario}`} title="Copiar el mensaje de WhatsApp con el enlace">
                                <MessageCircle className="h-3.5 w-3.5" />
                                {copiado === `${f.employeeId}-m` ? 'Copiado' : 'Mensaje'}
                              </button>
                              <button type="button" onClick={() => void copiar(f, f.enlace!.ruta, false)} className={`${BOTON.base} ${BOTON.secundario}`} title="Copiar solo el enlace">
                                <Copy className="h-3.5 w-3.5" />
                                {copiado === `${f.employeeId}-u` ? 'Copiado' : 'Enlace'}
                              </button>
                            </>
                          )}
                          <button type="button" disabled={ocupado !== null} onClick={() => void generar(f)} className={`${BOTON.base} ${f.datos || f.enlace ? BOTON.secundario : BOTON.primario}`}>
                            <Link2 className="h-3.5 w-3.5" />
                            {ocupado === f.employeeId ? 'Creando…' : f.enlace ? 'Nuevo enlace' : f.datos ? 'Pedir de nuevo' : 'Pedir datos'}
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </>
  )
}
