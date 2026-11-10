'use client'

import { useCallback, useEffect, useState } from 'react'
import { CircleAlert, RefreshCw } from 'lucide-react'
import { AVISO, BOTON, COLOR_ESTADO, TABLA, TEXTO, TIPO } from '@/lib/estilo/denso'
import { Cargando, Vacio } from '@/components/plataforma/comun'
import type { EntradaDeLog } from '@/lib/ads/cuenta'
import { llamar } from './llamar'

const ORIGENES: Array<{ id: '' | EntradaDeLog['origen']; nombre: string }> = [
  { id: '', nombre: 'Todo' },
  { id: 'automatico', nombre: 'Automático' },
  { id: 'estructura', nombre: 'Estructura' },
  { id: 'manual', nombre: 'Manual' },
]

const ROTULO_ORIGEN: Record<EntradaDeLog['origen'], string> = { automatico: 'Automático', estructura: 'Estructura', manual: 'Manual' }

/**
 * EL LOG DE CAMBIOS de la cuenta: qué se creó o se cambió, cuándo, desde qué valor y por qué. «Registra cambios, no análisis»: una línea de motivo y ya. Lo que hace el sistema solo sale como
 * «Automático»; lo que monta el botón de campañas, como «Estructura». Los intentos que fallan también están (en rojo): un fallo es información.
 */
export function PestanaLog({ perfilId }: { perfilId: string }) {
  const [origen, setOrigen] = useState<'' | EntradaDeLog['origen']>('')
  const [entradas, setEntradas] = useState<EntradaDeLog[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const r = await llamar<{ entradas: EntradaDeLog[] }>(`/api/ads/cuenta/log?perfilId=${perfilId}${origen ? `&origen=${origen}` : ''}`)
      setEntradas(r.entradas)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido cargar el log.')
    }
  }, [perfilId, origen])

  useEffect(() => {
    setEntradas(null)
    void cargar()
  }, [cargar])

  if (error) return <p className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.rojo }}>{error}</p>

  return (
    <div className="flex flex-col gap-2 pb-6">
      <div className="flex flex-wrap items-center gap-[6px]">
        {ORIGENES.map((o) => (
          <button key={o.id || 'todo'} type="button" onClick={() => setOrigen(o.id)} className={`${BOTON.chip} ${origen === o.id ? BOTON.chipEncendido : ''}`}>{o.nombre}</button>
        ))}
        <button type="button" onClick={() => { setEntradas(null); void cargar() }} className={`${BOTON.base} ${BOTON.secundario} ml-auto`}><RefreshCw className="h-3 w-3" /> Actualizar</button>
      </div>

      {!entradas ? (
        <Cargando />
      ) : entradas.length === 0 ? (
        <Vacio icono={<RefreshCw />} titulo="Todavía no hay ningún cambio registrado">
          Aquí aparece cada campaña que se crea desde Marketing Test y, cuando el sistema opere por su cuenta, cada cambio automático.
        </Vacio>
      ) : (
        <div className={TABLA.caja}>
          <table className={TABLA.tabla}>
            <thead>
              <tr>
                {['Cuándo', 'Origen', 'Qué', 'Campaña', 'Valor anterior', 'Valor nuevo', 'Motivo / quién'].map((h) => (
                  <th key={h} className={TABLA.cabecera}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entradas.map((e) => (
                <tr key={e.id} className={TABLA.fila}>
                  <td className={TABLA.celda}>{new Date(e.creadoAt).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className={TABLA.celda}>{ROTULO_ORIGEN[e.origen]}</td>
                  <td className={TABLA.celda}>
                    {!e.ok && <CircleAlert className="mr-1 inline h-3 w-3" style={{ color: COLOR_ESTADO.rojo }} />}
                    {e.accion} {e.entidad}{e.campo ? ` · ${e.campo}` : ''}
                  </td>
                  <td className={TABLA.celda}><span className={`${TABLA.corta} max-w-[320px]`} title={e.nombreCampana ?? ''}>{e.nombreCampana ?? '—'}</span></td>
                  <td className={TABLA.celda}>{e.valorAnterior ?? <span className={TEXTO.t4}>—</span>}</td>
                  <td className={TABLA.celda}><span className={`${TABLA.corta} max-w-[360px]`} title={e.valorNuevo ?? ''}>{e.valorNuevo ?? <span className={TEXTO.t4}>—</span>}</span></td>
                  <td className={TABLA.celda}>
                    <span className={`${TABLA.corta} max-w-[380px]`} title={e.error ?? e.motivo ?? ''} style={!e.ok ? { color: COLOR_ESTADO.rojo } : undefined}>{e.ok ? (e.motivo ?? '') : e.error}</span>
                    {e.usuario && <span className={`${TIPO.xs} ${TEXTO.t4}`}> {e.usuario}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
