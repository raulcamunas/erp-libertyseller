'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ClipboardCopy, CircleAlert, RefreshCw } from 'lucide-react'
import { AVISO, BOTON, COLOR_ESTADO, TABLA, TEXTO, TIPO } from '@/lib/estilo/denso'
import { Cargando, Vacio } from '@/components/plataforma/comun'
import type { EntradaDeLog } from '@/lib/ads/cuenta'
import { textoParaPegar } from '@/lib/ads/log-sop'
import { llamar } from './llamar'

const ORIGENES: Array<{ id: '' | EntradaDeLog['origen']; nombre: string }> = [
  { id: '', nombre: 'Todo' },
  { id: 'automatico', nombre: 'Automático' },
  { id: 'estructura', nombre: 'Estructura' },
  { id: 'manual', nombre: 'Manual' },
]

const ROTULO_ORIGEN: Record<EntradaDeLog['origen'], string> = { automatico: 'Automático', estructura: 'Estructura', manual: 'Manual' }

const PERIODOS = [
  { dias: 1, texto: 'Hoy' },
  { dias: 7, texto: '7 días' },
  { dias: 14, texto: '14 días' },
  { dias: 30, texto: '30 días' },
] as const

/**
 * EL LOG DE CAMBIOS de la cuenta: qué se creó o se cambió, cuándo, desde qué valor y por qué. «Registra cambios, no análisis»: una línea de motivo y ya. Lo que hace el sistema solo sale como
 * «Automático»; lo que monta el botón de campañas, como «Estructura». Los intentos que fallan también están (en rojo): un fallo es información.
 */
export function PestanaLog({ perfilId }: { perfilId: string }) {
  const [origen, setOrigen] = useState<'' | EntradaDeLog['origen']>('')
  const [entradas, setEntradas] = useState<EntradaDeLog[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [diasCopia, setDiasCopia] = useState<number>(7)
  const [fuera, setFuera] = useState<Array<{ que: string; motivo: string }>>([])

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

  /**
   * COPIAR PARA EL LOG DEL CLIENTE (el Google Sheets «Logs Marketing»): las seis columnas del SOP, en su orden y con su vocabulario, listas para pegar. Solo lo que Amazon aceptó; lo que no encaja en el
   * vocabulario (pausar, deshacer) se enseña debajo para apuntarlo a mano, en vez de forzarlo. La traducción está en lib/ads/log-sop.ts (con pruebas).
   */
  async function copiar() {
    if (!entradas) return
    const desde = new Date()
    desde.setHours(0, 0, 0, 0)
    desde.setDate(desde.getDate() - (diasCopia - 1))
    const r = textoParaPegar(entradas.filter((e) => Date.parse(e.creadoAt) >= desde.getTime()))
    setFuera(r.fuera)
    if (r.filas === 0) {
      toast.info(`No hay cambios aceptados que copiar en ${diasCopia === 1 ? 'el día de hoy' : `los últimos ${diasCopia} días`}.`)
      return
    }
    try {
      await navigator.clipboard.writeText(r.texto)
      toast.success(`${r.filas} ${r.filas === 1 ? 'fila copiada' : 'filas copiadas'}: pégalas en el Log del cliente (Keyword · Tipo de Campaña · Acción · Valor anterior · Nuevo valor · Fecha).`)
    } catch {
      toast.error('El navegador no ha dejado copiar. Prueba otra vez con la pestaña en primer plano.')
    }
  }

  if (error) return <p className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.rojo }}>{error}</p>

  return (
    <div className="flex flex-col gap-2 pb-6">
      <div className="flex flex-wrap items-center gap-[6px]">
        {ORIGENES.map((o) => (
          <button key={o.id || 'todo'} type="button" onClick={() => setOrigen(o.id)} className={`${BOTON.chip} ${origen === o.id ? BOTON.chipEncendido : ''}`}>{o.nombre}</button>
        ))}
        <span className="ml-auto flex flex-wrap items-center gap-[6px]">
          <select value={diasCopia} onChange={(e) => setDiasCopia(Number(e.target.value))} className="h-[26px] rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-2 text-[12px] text-[var(--ls-t1)]" aria-label="Periodo a copiar">
            {PERIODOS.map((p) => (
              <option key={p.dias} value={p.dias}>{p.texto}</option>
            ))}
          </select>
          <button type="button" disabled={!entradas} onClick={() => void copiar()} className={`${BOTON.base} ${BOTON.primario}`} title="Copia los cambios aceptados con las seis columnas del Log del SOP, para pegarlos en el Google Sheets del cliente">
            <ClipboardCopy className="h-3 w-3" /> Copiar para el Log del cliente
          </button>
          <button type="button" onClick={() => { setEntradas(null); void cargar() }} className={`${BOTON.base} ${BOTON.secundario}`}><RefreshCw className="h-3 w-3" /> Actualizar</button>
        </span>
      </div>

      {fuera.length > 0 && (
        <div className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
          <CircleAlert className={AVISO.icono} />
          <span>
            <span className={AVISO.fuerte}>{fuera.length} {fuera.length === 1 ? 'cambio no se ha copiado' : 'cambios no se han copiado'}</span> porque no encajan en el vocabulario del Log del SOP: apúntalos a mano si hace falta.{' '}
            {fuera.slice(0, 4).map((f) => `${f.que} (${f.motivo})`).join(' · ')}
            {fuera.length > 4 ? ' …' : ''}
          </span>
        </div>
      )}

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
