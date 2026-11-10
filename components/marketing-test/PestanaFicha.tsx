'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { BadgeCheck, ShieldAlert } from 'lucide-react'
import { AVISO, BOTON, CAMPO, COLOR_ESTADO, TARJETA, TEXTO, TIPO, TITULO } from '@/lib/estilo/denso'
import { Cargando } from '@/components/plataforma/comun'
import type { FichaDeCuenta } from '@/lib/ads/cuenta'
import { llamar } from './llamar'

type Campos = Omit<FichaDeCuenta, 'firmadaPor' | 'firmadaPorNombre' | 'firmadaAt' | 'guardada'>

/** Los campos numéricos de la ficha, agrupados como en el SOP (sección 05). `nota` es lo que dice el SOP de cada uno */
const GRUPOS: Array<{ titulo: string; campos: Array<{ clave: keyof Campos; nombre: string; unidad: string; nota: string; paso?: number }> }> = [
  {
    titulo: 'Objetivos de la cuenta',
    campos: [
      { clave: 'tacosObjetivoPct', nombre: 'TACoS objetivo', unidad: '%', nota: '8-12 % en fase madura.', paso: 0.5 },
      { clave: 'presupuestoMensual', nombre: 'Presupuesto mensual', unidad: 'moneda', nota: 'Del contrato. Vacío si todavía no está acordado.', paso: 10 },
    ],
  },
  {
    titulo: 'Presupuesto y pujas',
    campos: [
      { clave: 'subidaPresupuestoPct', nombre: 'Subida de presupuesto', unidad: '%', nota: '+20-25 % por movimiento.', paso: 1 },
      { clave: 'horasEntreSubidas', nombre: 'Entre subidas de presupuesto', unidad: 'horas', nota: 'Máximo una cada 72 h.' },
      { clave: 'cambioPujaPct', nombre: 'Subida o bajada de puja', unidad: '%', nota: '±10-15 % por movimiento.', paso: 1 },
      { clave: 'diasEntreCambiosPuja', nombre: 'Entre cambios de puja (por keyword)', unidad: 'días', nota: 'Máximo uno cada 7 días.' },
    ],
  },
  {
    titulo: 'Keywords y términos',
    campos: [
      { clave: 'comprasParaExacta', nombre: 'Compras para consolidar a Exacta', unidad: 'pedidos', nota: '≥ 2 pedidos con ACoS ≤ objetivo…' },
      { clave: 'ventanaExactaDias', nombre: '…en una ventana de', unidad: 'días', nota: '14 días.' },
      { clave: 'gastoSinVentaX', nombre: 'Gasto sin venta antes de negativizar', unidad: '× CPA objetivo', nota: '2× el CPA objetivo…', paso: 0.5 },
      { clave: 'clicsMinimosNegativizar', nombre: '…con un mínimo de', unidad: 'clics', nota: '15 clics.' },
      { clave: 'muestraMinimaClics', nombre: 'Muestra mínima de clics', unidad: 'clics', nota: '1 ÷ CVR de la categoría. Típico: 10-15.' },
    ],
  },
]

const aCampos = (f: FichaDeCuenta): Campos => {
  const { firmadaPor: _a, firmadaPorNombre: _b, firmadaAt: _c, guardada: _d, ...resto } = f
  return resto
}

/**
 * LA FICHA DE CUENTA (SOP, sección 05): los parámetros que se firman una vez por cuenta antes de tocar ninguna campaña. Nace con los «valor de arranque propuesto» del SOP; se convierte en doctrina
 * cuando alguien la FIRMA. Cambiar cualquier número de una ficha firmada le quita la firma.
 */
export function PestanaFicha({ perfilId }: { perfilId: string }) {
  const [ficha, setFicha] = useState<FichaDeCuenta | null>(null)
  const [campos, setCampos] = useState<Campos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const r = await llamar<{ ficha: FichaDeCuenta }>(`/api/ads/cuenta/ficha?perfilId=${perfilId}`)
      setFicha(r.ficha)
      setCampos(aCampos(r.ficha))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido cargar la ficha.')
    }
  }, [perfilId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const sucia = useMemo(() => !!ficha && !!campos && JSON.stringify(aCampos(ficha)) !== JSON.stringify(campos), [ficha, campos])

  async function guardar() {
    if (!campos) return
    setOcupado(true)
    try {
      const r = await llamar<{ ficha: FichaDeCuenta }>('/api/ads/cuenta/ficha', { metodo: 'PUT', cuerpo: { perfilId, ...campos } })
      const perdioFirma = !!ficha?.firmadaAt && !r.ficha.firmadaAt
      setFicha(r.ficha)
      setCampos(aCampos(r.ficha))
      toast.success(perdioFirma ? 'Ficha guardada. Al cambiar valores, ha perdido la firma: hay que firmarla otra vez.' : 'Ficha guardada.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido guardar.')
    } finally {
      setOcupado(false)
    }
  }

  async function firma(accion: 'firmar' | 'quitar-firma') {
    setOcupado(true)
    try {
      const r = await llamar<{ ficha: FichaDeCuenta }>('/api/ads/cuenta/ficha', { metodo: 'POST', cuerpo: { perfilId, accion } })
      setFicha(r.ficha)
      toast.success(accion === 'firmar' ? 'Ficha firmada.' : 'Firma retirada.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido firmar.')
    } finally {
      setOcupado(false)
    }
  }

  if (error) return <p className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.rojo }}>{error}</p>
  if (!ficha || !campos) return <Cargando />

  const firmada = !!ficha.firmadaAt

  return (
    <div className="flex max-w-[980px] flex-col gap-2 pb-6">
      {firmada ? (
        <div className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.verde }}>
          <BadgeCheck className={AVISO.icono} />
          <span>
            <span className={AVISO.fuerte}>Ficha firmada</span> por {ficha.firmadaPorNombre ?? 'un administrador'} el {new Date(ficha.firmadaAt as string).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}. Estos valores son doctrina de la cuenta.
          </span>
        </div>
      ) : (
        <div className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
          <ShieldAlert className={AVISO.icono} />
          <span>
            <span className={AVISO.fuerte}>Sin firmar.</span> {ficha.guardada ? 'Revísala y fírmala' : 'Son los valores de arranque propuestos por el SOP: ajústalos, guarda y fírmala'} antes de dejar que el sistema opere por su cuenta. Mientras no esté firmada, cada decisión se justifica una a una.
          </span>
        </div>
      )}

      <div className={`${AVISO.base}`}>
        <span>
          El <span className={AVISO.fuerte}>ACoS objetivo</span> ya no se fija aquí: se elige en cada producto (pestaña <strong>Productos</strong>), que es donde se sabe cuánto margen tiene.
        </span>
      </div>

      {GRUPOS.map((g) => (
        <section key={g.titulo} className={TARJETA.base}>
          <header className={TARJETA.cabecera}>
            <h2 className={TITULO.seccion}>{g.titulo}</h2>
          </header>
          <div className={`${TARJETA.cuerpo} grid gap-x-4 gap-y-3 sm:grid-cols-2`}>
            {g.campos.map((c) => (
              <div key={c.clave} className={CAMPO.contenedor}>
                <label className={CAMPO.etiqueta} htmlFor={`f-${c.clave}`}>
                  {c.nombre} <span className="font-normal">({c.unidad})</span>
                </label>
                <input
                  id={`f-${c.clave}`}
                  type="number"
                  inputMode="decimal"
                  step={c.paso ?? 1}
                  value={(campos[c.clave] as number | null) ?? ''}
                  onChange={(e) => setCampos({ ...campos, [c.clave]: e.target.value === '' ? null : Number(e.target.value) })}
                  className={`${CAMPO.input} ${CAMPO.numero}`}
                />
                <p className={CAMPO.nota}>{c.nota}</p>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section className={TARJETA.base}>
        <header className={TARJETA.cabecera}>
          <h2 className={TITULO.seccion}>Notas</h2>
        </header>
        <div className={TARJETA.cuerpo}>
          <textarea value={campos.notas ?? ''} onChange={(e) => setCampos({ ...campos, notas: e.target.value || null })} rows={3} className={`${CAMPO.input} h-auto py-1`} placeholder="Acuerdos con el cliente, particularidades de la cuenta…" />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={ocupado || !sucia} onClick={guardar} className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario}`}>
          {ocupado ? 'Guardando…' : 'Guardar ficha'}
        </button>
        {firmada ? (
          <button type="button" disabled={ocupado || sucia} onClick={() => firma('quitar-firma')} className={`${BOTON.base} ${BOTON.alto} ${BOTON.secundario}`}>
            Quitar la firma
          </button>
        ) : (
          <button type="button" disabled={ocupado || sucia || !ficha.guardada} onClick={() => firma('firmar')} className={`${BOTON.base} ${BOTON.alto} ${BOTON.secundario}`} title={sucia || !ficha.guardada ? 'Guarda primero: se firma lo que se ha revisado' : undefined}>
            Firmar la ficha
          </button>
        )}
        {sucia && <span className={`${TIPO.xs} ${TEXTO.t3}`}>Cambios sin guardar.</span>}
      </div>
    </div>
  )
}
