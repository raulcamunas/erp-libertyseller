'use client'

import { useState } from 'react'
import { patchAmazon } from '@/lib/amazon/client'
import { BOTON, CAMPO, TEXTO, TIPO } from '@/lib/estilo/denso'
import { Dialogo, nombreMarketplace } from '@/components/plataforma/comun'
import { COLCHON_SUGERIDO } from '@/lib/plataforma/fbmfba/tipos'
import type {
  ConfigA4Respuesta,
  ConfigFbmFba,
  FiscalRespuesta,
  ParametrosFiscales,
  SugerenciaFiscal,
} from '@/lib/plataforma/fbmfba/cliente'

/**
 * LOS DOS AJUSTES DE LOS QUE DEPENDE QUE ESTA PANTALLA DIGA ALGO.
 *
 * Y los dos comparten la misma regla, que es la que hace honesto el módulo:
 *
 *     VACÍO SIGNIFICA «NO DECIDIDO», Y CON «NO DECIDIDO» NO SE RECOMIENDA.
 *
 * Ningún campo nace con un número puesto. La sugerencia que se enseña al lado
 * —el 10-12 % del colchón, el 21 % de España— NO ES UN VALOR POR DEFECTO y el
 * motor no la consulta: hace falta pulsar para guardarla, y entonces la fila
 * tiene fecha y dueño. Esa es toda la diferencia entre un dato y una suposición,
 * y aquí importa porque lo que se decide con estos números es si un cliente
 * manda un palé a un almacén del que sacarlo cuesta dinero.
 */

/* ------------------------------------------------------------------ */
/* 1. Los umbrales del cliente                                         */
/* ------------------------------------------------------------------ */

export function DialogoUmbrales({
  clientId,
  config,
  onCerrar,
  onGuardado,
}: {
  clientId: string
  config: ConfigFbmFba
  onCerrar: () => void
  onGuardado: (mensaje: string) => void
}) {
  const [colchon, setColchon] = useState(texto(config.colchonMargenPct))
  const [mejora, setMejora] = useState(texto(config.mejoraMinimaPuntos))
  const [rotacion, setRotacion] = useState(texto(config.rotacionMinimaUnidades))
  const [ventana, setVentana] = useState(texto(config.rotacionVentanaDias))
  const [bsr, setBsr] = useState(texto(config.bsrMaximo))
  const [dims, setDims] = useState(config.exigirDimensionesFiables)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    setGuardando(true)
    setError(null)
    const res = await patchAmazon<ConfigA4Respuesta>('/api/plataforma/fbmfba/config', {
      clientId,
      // Se manda la clave SIEMPRE, aunque venga vacía: vacío es `null` y `null`
      // es una decisión —«que el ranking no descarte a nadie»—, no un olvido.
      colchonMargenPct: numero(colchon),
      mejoraMinimaPuntos: numero(mejora),
      rotacionMinimaUnidades: numero(rotacion),
      rotacionVentanaDias: numero(ventana) ?? 30,
      bsrMaximo: numero(bsr),
      exigirDimensionesFiables: dims,
    })
    setGuardando(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    onGuardado(res.data.mensaje ?? 'Guardado.')
    onCerrar()
  }

  return (
    <Dialogo
      titulo="Umbrales de este cliente"
      entradilla="Vacío = no decidido, y con eso el análisis informa pero no recomienda."
      onCerrar={onCerrar}
      pie={
        <>
          <button type="button" onClick={onCerrar} className={`${BOTON.base} ${BOTON.secundario}`}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void guardar()}
            disabled={guardando}
            className={`${BOTON.base} ${BOTON.primario}`}
          >
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }
    >
      {error && <p className={`${TIPO.s}`} style={{ color: 'var(--ls-e-rojo)' }}>{error}</p>}

      <div className={CAMPO.rejilla}>
        <Campo
          etiqueta="Colchón de margen en FBA (%)"
          valor={colchon}
          onCambio={setColchon}
          nota={`No es «que dé más que hoy»: una referencia puede mejorar y quedarse en un 2 %, y un 2 % vendiendo al techo de Amazon es inventario muerto en cuanto un competidor baje un céntimo. La especificación habla de un ${COLCHON_SUGERIDO.min}-${COLCHON_SUGERIDO.max} %.`}
          sugerencia={String(COLCHON_SUGERIDO.min)}
          onSugerencia={setColchon}
        />
        <Campo
          etiqueta="Mejora mínima que justifica mover (puntos)"
          valor={mejora}
          onCambio={setMejora}
          nota="Con 0 se recomendaría migrar por una décima de punto, que no paga ni preparar el envío."
        />
        <Campo
          etiqueta="Rotación mínima (unidades)"
          valor={rotacion}
          onCambio={setRotacion}
          nota="En FBA lo que no rota paga almacenamiento cada mes. Vacío = la rotación no filtra."
        />
        <Campo
          etiqueta="Ventana de la rotación (días)"
          valor={ventana}
          onCambio={setVentana}
          nota="Técnico: 30 días es el mes natural."
        />
        <Campo
          etiqueta="Ranking máximo sin datos de ventas"
          valor={bsr}
          onCambio={setBsr}
          nota="Es lo único que queda cuando no hay unidades. OJO: el ranking ORDENA, NO MIDE, y no es comparable entre categorías. Vacío = no descarta a nadie."
        />
      </div>

      <label className="flex items-start gap-[6px]">
        <input
          type="checkbox"
          checked={dims}
          onChange={(e) => setDims(e.target.checked)}
          className="mt-[2px]"
        />
        <span>
          <span className={`${TIPO.m} ${TEXTO.t1}`}>
            Frenar las referencias cuyas medidas no son de fiar
          </span>
          <span className={`block ${TIPO.s} ${TEXTO.t3}`}>
            La tarifa de FBA se calcula sobre el embalaje y un salto de tramo de tamaño cambia el
            importe. No existe ningún campo que diga si una medida la comprobó Amazon o la escribió
            el vendedor.
          </span>
        </span>
      </label>
    </Dialogo>
  )
}

/* ------------------------------------------------------------------ */
/* 2. El impuesto del marketplace                                      */
/* ------------------------------------------------------------------ */

/**
 * SIN ESTO NO HAY NI UN NÚMERO EN LA PANTALLA, y es a propósito.
 *
 * Son DOS datos: el tipo y SI EL PRECIO LO LLEVA DENTRO. El segundo no tiene
 * valor por defecto porque los dos casos existen —la Unión Europea lo lleva,
 * Estados Unidos no— y equivocarse mueve el margen un 20 % sin dar ningún aviso,
 * porque el número que sale es perfectamente creíble.
 *
 * Se guarda con FECHA DE VIGENCIA: los tipos cambian por ley y el margen que se
 * le enseñó a un cliente en marzo tiene que seguir cuadrando con el de marzo.
 */
export function DialogoImpuesto({
  clientId,
  marketplaceId,
  fiscal,
  sugerencia,
  onCerrar,
  onGuardado,
}: {
  clientId: string
  marketplaceId: string
  fiscal: ParametrosFiscales
  sugerencia: SugerenciaFiscal | null
  onCerrar: () => void
  onGuardado: (mensaje: string) => void
}) {
  const [iva, setIva] = useState(texto(fiscal.ivaPorcentaje))
  const [dentro, setDentro] = useState<'si' | 'no' | ''>(
    fiscal.precioIncluyeImpuesto === true ? 'si' : fiscal.precioIncluyeImpuesto === false ? 'no' : ''
  )
  const [soloCliente, setSoloCliente] = useState(fiscal.ambito === 'cliente')
  const [desde, setDesde] = useState(fiscal.validoDesde ?? new Date().toISOString().slice(0, 10))
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    if (dentro === '') {
      setError('Hay que decir si el precio de este país lleva el impuesto dentro.')
      return
    }
    setGuardando(true)
    setError(null)
    const res = await patchAmazon<FiscalRespuesta>('/api/plataforma/fbmfba/fiscal', {
      marketplaceId,
      clientId: soloCliente ? clientId : null,
      ivaPorcentaje: numero(iva),
      precioIncluyeImpuesto: dentro === 'si',
      validoDesde: desde,
    })
    setGuardando(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    onGuardado(res.data.mensaje ?? 'Guardado.')
    onCerrar()
  }

  return (
    <Dialogo
      titulo={`Impuesto de ${nombreMarketplace(marketplaceId)}`}
      entradilla="Ningún endpoint de Amazon da el tipo con los roles que tenemos. Es una tabla con fecha y dueño."
      onCerrar={onCerrar}
      pie={
        <>
          <button type="button" onClick={onCerrar} className={`${BOTON.base} ${BOTON.secundario}`}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void guardar()}
            disabled={guardando}
            className={`${BOTON.base} ${BOTON.primario}`}
          >
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }
    >
      {error && <p className={`${TIPO.s}`} style={{ color: 'var(--ls-e-rojo)' }}>{error}</p>}

      <div className={CAMPO.rejilla}>
        <div className={CAMPO.contenedor}>
          <label className={CAMPO.etiqueta}>
            ¿El precio lleva el impuesto dentro? <span className={CAMPO.obligatorio}>*</span>
          </label>
          <select
            value={dentro}
            onChange={(e) => setDentro(e.target.value as 'si' | 'no' | '')}
            className={CAMPO.input}
          >
            <option value="">Sin decidir</option>
            <option value="si">Sí — el precio ya lleva el impuesto (Unión Europea)</option>
            <option value="no">No — se añade en el pago (Estados Unidos)</option>
          </select>
          <p className={CAMPO.nota}>
            Dividir por (1 + IVA) donde el impuesto va fuera hunde el margen un 20 %.
          </p>
        </div>

        <Campo
          etiqueta="Tipo de IVA (%)"
          valor={iva}
          onCambio={setIva}
          nota="El tipo general del país. Los reducidos —libros, alimentación, farmacia— van por categoría y hay que corregirlos."
          sugerencia={sugerencia ? String(sugerencia.ivaPorcentaje) : undefined}
          onSugerencia={
            sugerencia
              ? () => {
                  setIva(String(sugerencia.ivaPorcentaje))
                  setDentro(sugerencia.precioIncluyeImpuesto ? 'si' : 'no')
                }
              : undefined
          }
        />

        <div className={CAMPO.contenedor}>
          <label className={CAMPO.etiqueta}>Rige desde</label>
          <input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className={CAMPO.input}
          />
          <p className={CAMPO.nota}>Los tipos cambian por ley: cada fecha es un tramo, no un borrado.</p>
        </div>
      </div>

      {sugerencia && (
        <p className={`${TIPO.s} ${TEXTO.t3}`}>{sugerencia.nota}</p>
      )}

      <label className="flex items-start gap-[6px]">
        <input
          type="checkbox"
          checked={soloCliente}
          onChange={(e) => setSoloCliente(e.target.checked)}
          className="mt-[2px]"
        />
        <span>
          <span className={`${TIPO.m} ${TEXTO.t1}`}>Solo para este cliente</span>
          <span className={`block ${TIPO.s} ${TEXTO.t3}`}>
            Sin marcar se guarda la regla general del país, que vale para todos. Márcalo cuando este
            cliente tenga un régimen distinto: el régimen fiscal no es solo del país.
          </span>
        </span>
      </label>
    </Dialogo>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

function Campo({
  etiqueta,
  valor,
  onCambio,
  nota,
  sugerencia,
  onSugerencia,
}: {
  etiqueta: string
  valor: string
  onCambio: (v: string) => void
  nota: string
  /** Lo que propone la especificación o el país. NO se aplica solo */
  sugerencia?: string
  onSugerencia?: ((v: string) => void) | (() => void)
}) {
  return (
    <div className={CAMPO.contenedor}>
      <label className={CAMPO.etiqueta}>{etiqueta}</label>
      <div className="flex items-center gap-[5px]">
        <input
          value={valor}
          onChange={(e) => onCambio(e.target.value)}
          inputMode="decimal"
          placeholder="sin decidir"
          className={`${CAMPO.input} ${CAMPO.numero}`}
        />
        {sugerencia !== undefined && onSugerencia && (
          <button
            type="button"
            onClick={() => (onSugerencia as (v: string) => void)(sugerencia)}
            className={`${BOTON.base} ${BOTON.secundario} shrink-0`}
            title="Lo propone la especificación, no el programa: hay que guardarlo para que exista, y entonces tiene fecha y dueño."
          >
            {sugerencia}
          </button>
        )}
      </div>
      <p className={CAMPO.nota}>{nota}</p>
    </div>
  )
}

function texto(valor: number | null): string {
  return valor === null || valor === undefined ? '' : String(valor)
}

/** Vacío es `null` —no decidido—, nunca 0 */
function numero(valor: string): number | null {
  const limpio = valor.trim().replace(',', '.')
  if (limpio === '') return null
  const n = Number(limpio)
  return Number.isFinite(n) ? n : null
}
