'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, X } from 'lucide-react'
import { BOTON, TABLA, TARJETA, TEXTO, TIPO, TITULO } from '@/lib/estilo/denso'
import { ETIQUETA_REGISTRO, type FilaRegistro } from '@/lib/facturacion/tipos'
import { Aviso, dinero, pedir, SobreLaPagina } from './comun'

function resumen(f: FilaRegistro): string {
  const d = f.detalle as { para?: string[]; referencia?: string | null; accion?: string; tipo?: string | null; plantillaNombre?: string | null }
  if (f.tipo === 'envio') return [d.para?.join(', '), d.plantillaNombre].filter(Boolean).join(' · ')
  if (f.tipo === 'cobro') return d.referencia ? `Referencia ${d.referencia}` : ''
  if (f.tipo === 'gasto') return d.tipo ?? ''
  if (f.tipo === 'plantilla') return d.accion ?? ''
  return ''
}

/** Quién hizo qué y cuándo, y el correo tal como salió */
export function PestanaRegistro() {
  const [filas, setFilas] = useState<FilaRegistro[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [correo, setCorreo] = useState<FilaRegistro | null>(null)

  useEffect(() => {
    pedir<{ filas: FilaRegistro[] }>('/api/facturacion/registro')
      .then((d) => setFilas(d.filas))
      .catch((e: Error) => setError(e.message))
  }, [])

  if (error) {
    return (
      <Aviso tono="ambar" icono={AlertTriangle}>
        {error}
      </Aviso>
    )
  }
  if (!filas) {
    return (
      <div className={`flex items-center justify-center gap-2 py-16 ${TIPO.s} ${TEXTO.t3}`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Leyendo el registro…
      </div>
    )
  }

  const verCorreo = correo?.detalle as { asunto?: string; cuerpo?: string; para?: string[]; cc?: string[] } | undefined

  return (
    <div className={TARJETA.base}>
      {filas.length === 0 ? (
        <p className={`${TARJETA.cuerpo} ${TIPO.s} ${TEXTO.t3}`}>Todavía no se ha hecho nada desde esta pantalla.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={TABLA.tabla}>
            <thead>
              <tr>
                <th className={TABLA.cabecera}>Cuándo</th>
                <th className={TABLA.cabecera}>Qué</th>
                <th className={TABLA.cabecera}>Factura</th>
                <th className={TABLA.cabecera}>Cliente</th>
                <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Importe</th>
                <th className={TABLA.cabecera}>Detalle</th>
                <th className={TABLA.cabecera}>Quién</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className={TABLA.fila}>
                  <td className={TABLA.celda}>{new Date(f.creado_en).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td className={TABLA.celda}>{ETIQUETA_REGISTRO[f.tipo]}</td>
                  <td className={TABLA.celda}>{f.numero ?? '—'}</td>
                  <td className={TABLA.celda}>{f.cliente ?? '—'}</td>
                  <td className={`${TABLA.celda} ${TABLA.numero}`}>{f.importe != null ? dinero(f.importe, f.moneda ?? 'EUR') : '—'}</td>
                  <td className={TABLA.celda}>
                    <span className={`${TABLA.corta} inline-block max-w-[300px] align-middle`} title={resumen(f)}>
                      {resumen(f) || '—'}
                    </span>
                    {f.tipo === 'envio' && (
                      <button type="button" onClick={() => setCorreo(f)} className={`${BOTON.base} ${BOTON.secundario} ml-2`}>
                        Ver correo
                      </button>
                    )}
                  </td>
                  <td className={TABLA.celda}>{f.hecho_por_nombre ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {correo && verCorreo && (
        <SobreLaPagina>
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={() => setCorreo(null)}>
          <div onClick={(e) => e.stopPropagation()} className="flex h-[85vh] w-full max-w-[760px] flex-col overflow-hidden rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)]">
            <div className={`${TARJETA.cabecera} justify-between`}>
              <span className={`${TITULO.seccion} truncate`}>{verCorreo.asunto}</span>
              <button type="button" aria-label="Cerrar" onClick={() => setCorreo(null)} className={BOTON.icono}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className={`px-3 py-1.5 ${TIPO.s} ${TEXTO.t3}`}>
              Para {verCorreo.para?.join(', ')}
              {verCorreo.cc?.length ? ` · copia a ${verCorreo.cc.join(', ')}` : ''}
            </p>
            <iframe srcDoc={verCorreo.cuerpo ?? ''} sandbox="" title="Correo enviado" className="min-h-0 w-full flex-1 border-0 bg-white" />
          </div>
        </div>
        </SobreLaPagina>
      )}
    </div>
  )
}
