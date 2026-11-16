'use client'

import { useState } from 'react'
import { ExternalLink, Pencil, Rocket, Shield, Snowflake, Tag, Target } from 'lucide-react'
import { Boton, Confirmacion, Insignia, PanelLateral, TablaAdaptable, Tarjeta, Variacion, type Columna } from '@/components/ui-ls'
import { COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'
import { AGENTE, type FaseDeProducto, type FuenteDeObjetivo, type FuenteDePostura, type PanelDelAgente, type Postura, type ProductoDelContexto } from '@/lib/ads/agente/tipos'
import { dinero } from '../formato'
import { CAMPO_AGENTE, diaYMes, pct, type Accion } from './TarjetaDeEstado'

const FUENTE: Record<FuenteDeObjetivo, string> = {
  humano: 'puesto a mano',
  equilibrio: 'por el margen',
  acos_real: 'por el ACoS real',
  tacos: 'por el TACoS',
}

const POSTURA: Record<Postura, { texto: string; tono: TonoEstado }> = {
  crecer: { texto: 'Crecer', tono: 'verde' },
  mantener: { texto: 'Mantener', tono: 'gris' },
  recortar: { texto: 'Recortar', tono: 'ambar' },
}

const FUENTE_POSTURA: Record<FuenteDePostura, string> = { ia: 'la IA', reglas: 'las reglas', ritmo: 'el ritmo del mes', stock: 'el stock' }

/** El color de la cobertura de stock: < 7 días recorta, < 14 mantiene */
const tonoCobertura = (dias: number | null): TonoEstado => (dias == null ? 'gris' : dias < AGENTE.COBERTURA_RECORTAR_DIAS ? 'rojo' : dias < AGENTE.COBERTURA_MANTENER_DIAS ? 'ambar' : 'verde')

type Fase = 'sin-cambio' | 'auto' | FaseDeProducto

/**
 * LOS OBJETIVOS DEL AGENTE: el TACoS objetivo, el techo de gasto del mes (el automático se congela: no se mide contra sí mismo) y, por producto, las ventas TOTALES del mes y el TACoS —la cifra
 * que manda— junto al ACoS objetivo, el de equilibrio, el ACoS de 14 días, la cobertura de stock y la postura. Un administrador pone la marca propia y la fase de cada producto.
 */
export function TarjetaDeObjetivos({ panel, moneda, accion, irA }: { panel: PanelDelAgente; moneda: string | null; accion: Accion; irA: (pestana: string) => void }) {
  const o = panel.objetivos
  const [editando, setEditando] = useState<ProductoDelContexto | null>(null)
  const [marca, setMarca] = useState('')
  const [fase, setFase] = useState<Fase>('sin-cambio')
  const [confirmar, setConfirmar] = useState(false)

  const abrir = (p: ProductoDelContexto) => {
    setEditando(p)
    setMarca(p.marca ?? '')
    setFase('sin-cambio')
  }

  const cambios = (() => {
    if (!editando) return null
    const c: { marca?: string | null; fase?: FaseDeProducto | null } = {}
    const m = marca.trim()
    if (m !== (editando.marca ?? '')) c.marca = m || null
    if (fase !== 'sin-cambio') c.fase = fase === 'auto' ? null : fase
    return Object.keys(c).length > 0 ? c : null
  })()
  const marcaCorta = marca.trim().length > 0 && marca.trim().length < AGENTE.MARCA_LETRAS_MIN

  const columnas: Columna<ProductoDelContexto>[] = [
    {
      id: 'producto',
      cabecera: 'Producto',
      movil: 'titulo',
      ordenar: (p) => p.nombre,
      celda: (p) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-[var(--ls-t1)]" title={p.nombre}>
            {p.nombre}
          </div>
          <div className="mt-[2px] flex flex-wrap items-center gap-1 text-[11.5px] text-[var(--ls-t4)]">
            <span className="tabular-nums">{p.asin}</span>
            {p.fase === 'lanzamiento' && (
              <Insignia tono="azul" tamano="sm" icono={Rocket}>
                Lanzamiento
              </Insignia>
            )}
            {p.marca && (
              <Insignia tono="violeta" tamano="sm" icono={Tag} title={`Marca propia: ${p.marca}. Sin subidas; ACoS de marca al ${Math.round(AGENTE.MARCA_ACOS_X * 100)} % del objetivo.`}>
                Marca · {p.marca}
              </Insignia>
            )}
            {p.soloDefensivo && (
              <Insignia tono="ambar" tamano="sm" icono={Shield} title="Sin coste del producto (sin ACoS de equilibrio) y sin ACoS puesto a mano: solo negativas, bajadas y pausas. Pon el coste en Productos para que pueda crecer.">
                Solo defensivo
              </Insignia>
            )}
          </div>
        </div>
      ),
    },
    {
      id: 'ventas',
      cabecera: 'Ventas totales del mes · TACoS',
      alinear: 'derecha',
      movil: 'subtitulo',
      ordenar: (p) => p.ventasTotalesMes ?? -1,
      celda: (p) => (
        <div className="text-right max-lg:text-left">
          <div className="flex items-baseline justify-end gap-2 max-lg:justify-start">
            <span className="text-[14px] font-semibold tabular-nums text-[var(--ls-t1)]">{dinero(p.ventasTotalesMes, moneda, 0)}</span>
            <span className="text-[13px] font-semibold tabular-nums" style={{ color: p.tacosMesPct != null && p.tacosMesPct > o.tacosObjetivoPct ? COLOR_ESTADO.ambar : 'var(--ls-t1)' }} title={`TACoS del mes (objetivo ${pct(o.tacosObjetivoPct)})`}>
              TACoS {pct(p.tacosMesPct)}
            </span>
          </div>
          <div className="mt-[2px] flex flex-wrap items-center justify-end gap-x-2 text-[11.5px] text-[var(--ls-t4)] max-lg:justify-start">
            <span>mes anterior {dinero(p.ventasTotalesMesAnterior, moneda, 0)}</span>
            <Variacion actual={p.ventasTotalesMes} anterior={p.ventasTotalesMesAnterior} mejor="sube" />
            <span>· TACoS {pct(p.tacosMesAnteriorPct)}</span>
          </div>
        </div>
      ),
    },
    {
      id: 'objetivo',
      cabecera: 'ACoS objetivo',
      alinear: 'derecha',
      rotuloMovil: 'ACoS objetivo',
      ordenar: (p) => p.acosObjetivoPct ?? -1,
      celda: (p) =>
        p.acosObjetivoPct == null ? (
          <span className="text-[12px] text-[var(--ls-t4)]">Sin objetivo</span>
        ) : (
          <span className="inline-flex flex-wrap items-center justify-end gap-1">
            <span className="tabular-nums">{pct(p.acosObjetivoPct)}</span>
            {p.fuenteObjetivo && p.fuenteObjetivo !== 'humano' && (
              <Insignia tono="cian" tamano="sm" icono={Snowflake} title={`Automático ${FUENTE[p.fuenteObjetivo]}${p.objetivoCongeladoAt ? `, congelado desde el ${diaYMes(p.objetivoCongeladoAt)}` : ''}. Solo lo sube una persona.`}>
                auto · {FUENTE[p.fuenteObjetivo]}
              </Insignia>
            )}
          </span>
        ),
    },
    { id: 'equilibrio', cabecera: 'Equilibrio', alinear: 'derecha', rotuloMovil: 'ACoS de equilibrio', ordenar: (p) => p.equilibrioPct ?? -1, celda: (p) => <span className="tabular-nums">{pct(p.equilibrioPct)}</span> },
    {
      id: 'acos14',
      cabecera: 'ACoS 14 d',
      alinear: 'derecha',
      rotuloMovil: 'ACoS 14 días',
      ordenar: (p) => p.acos14Pct ?? -1,
      celda: (p) => (
        <span className="tabular-nums" style={{ color: p.acos14Pct != null && p.acosObjetivoPct != null && p.acos14Pct > p.acosObjetivoPct * AGENTE.POSTURA_ACOS_MALO_X ? COLOR_ESTADO.rojo : undefined }}>
          {pct(p.acos14Pct)}
        </span>
      ),
    },
    {
      id: 'cobertura',
      cabecera: 'Cobertura',
      alinear: 'derecha',
      rotuloMovil: 'Cobertura de stock',
      ordenar: (p) => p.coberturaDias ?? -1,
      celda: (p) => (
        <span className="tabular-nums" style={{ color: COLOR_ESTADO[tonoCobertura(p.coberturaDias)] }} title={p.stock == null ? 'Stock desconocido: como mucho «mantener»' : `${p.stock.toLocaleString('es-ES')} unidades${p.stockActualizadoAt ? ` (leído el ${diaYMes(p.stockActualizadoAt)})` : ''}`}>
          {p.coberturaDias == null ? (p.stock == null ? 'sin dato' : `${p.stock.toLocaleString('es-ES')} ud.`) : `${Math.round(p.coberturaDias).toLocaleString('es-ES')} días`}
        </span>
      ),
    },
    {
      id: 'postura',
      cabecera: 'Postura',
      movil: 'insignia',
      ordenar: (p) => p.postura,
      celda: (p) => (
        <div className="min-w-0">
          <Insignia tono={POSTURA[p.postura].tono} tamano="sm" title={p.motivoPostura ?? undefined}>
            {POSTURA[p.postura].texto}
          </Insignia>
          {p.motivoPostura && (
            <div className="mt-[2px] line-clamp-2 text-[11.5px] leading-[1.35] text-[var(--ls-t4)] max-lg:hidden" title={p.motivoPostura}>
              {p.fuentePostura ? `Según ${FUENTE_POSTURA[p.fuentePostura]}: ` : ''}
              {p.motivoPostura}
            </div>
          )}
        </div>
      ),
    },
  ]

  return (
    <Tarjeta acento="marketing" icono={Target} titulo="Objetivos" subtitulo="Vender más con menos publicidad: ventas totales arriba y TACoS abajo, sin pasar del techo del mes.">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-[10px]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--ls-t4)]">TACoS objetivo</div>
          <div className="mt-[2px] text-[22px] font-semibold tabular-nums text-[var(--ls-t1)]">{pct(o.tacosObjetivoPct)}</div>
          <div className="text-[12px] text-[var(--ls-t3)]">Publicidad sobre ventas totales. Se cambia en la Ficha de cuenta.</div>
        </div>
        <div className="min-w-0 rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-[10px]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--ls-t4)]">Techo de gasto del mes</div>
          <div className="mt-[2px] flex flex-wrap items-center gap-2">
            <span className="text-[22px] font-semibold tabular-nums text-[var(--ls-t1)]">{o.techoMensual == null ? 'Sin techo' : dinero(o.techoMensual, moneda, 0)}</span>
            {o.techoMensual != null && o.techoAutomatico && (
              <Insignia tono="cian" tamano="sm" icono={Snowflake} title="Máximo entre el gasto de 30 días y el TACoS objetivo de las ventas totales: crece si el TACoS va bien, como mucho un 25 % al mes. Se revisa una vez al mes.">
                automático · revisado el {diaYMes(o.techoCongeladoAt)}
              </Insignia>
            )}
          </div>
          <div className="text-[12px] text-[var(--ls-t3)]">
            {o.techoMensual == null ? 'Sin gasto real ni presupuesto mensual: el agente no sube pujas ni presupuestos. ' : 'Solo Sponsored Products. '}
            <button type="button" className="inline-flex items-center gap-1 underline underline-offset-2 [@media(pointer:coarse)]:min-h-[44px]" onClick={() => irA('ficha')}>
              {o.techoAutomatico || o.techoMensual == null ? 'Ponlo en la Ficha' : 'Cambiar en la Ficha'} <ExternalLink className="h-3 w-3" aria-hidden />
            </button>
          </div>
        </div>
      </div>

      <TablaAdaptable
        className="mt-4"
        etiqueta="Productos del agente"
        columnas={columnas}
        filas={o.productos}
        claveDe={(p) => p.asin}
        ordenInicial={{ id: 'ventas', sentido: 'desc' }}
        porPagina={15}
        acciones={
          panel.esAdmin
            ? (p) => (
                <Boton variante="fantasma" tamano="sm" icono={Pencil} soloIcono aria-label={`Editar marca y fase de ${p.nombre}`} title="Marca propia y fase" onClick={() => abrir(p)} />
              )
            : undefined
        }
        vacio={{ icono: Target, titulo: 'Todavía no hay productos con anuncios', descripcion: 'Cuando haya campañas con la nomenclatura del SOP, aquí sale cada producto con sus objetivos.', accion: { texto: 'Ir a Productos', onClick: () => irA('productos') } }}
      />

      <PanelLateral
        abierto={editando !== null}
        onCambio={(a) => !a && setEditando(null)}
        titulo={editando?.nombre ?? 'Producto'}
        descripcion={editando ? `${editando.asin} · marca propia y fase para el agente` : undefined}
        icono={Pencil}
        acento="marketing"
        pie={
          <div className="flex justify-end gap-2">
            <Boton variante="fantasma" onClick={() => setEditando(null)}>
              Cancelar
            </Boton>
            <Boton variante="primario" disabled={!cambios || marcaCorta} onClick={() => setConfirmar(true)}>
              Guardar
            </Boton>
          </div>
        }
      >
        {editando && (
          <div className="flex flex-col gap-4 text-[13px] text-[var(--ls-t2)]">
            <label className="block">
              <span className="text-[12px] font-semibold text-[var(--ls-t3)]">Marca propia</span>
              <input className={`${CAMPO_AGENTE} mt-1`} value={marca} maxLength={60} onChange={(e) => setMarca(e.target.value)} placeholder="Ej.: Ham Master" />
              <span className="mt-1 block text-[12px] text-[var(--ls-t4)]">
                Los términos y campañas que la contienen son de marca: sin subidas y con un ACoS objetivo al {Math.round(AGENTE.MARCA_ACOS_X * 100)} %. Al menos {AGENTE.MARCA_LETRAS_MIN} letras; vacío = sin marca.
              </span>
              {marcaCorta && <span className="mt-1 block text-[12px]" style={{ color: COLOR_ESTADO.ambar }}>La marca necesita al menos {AGENTE.MARCA_LETRAS_MIN} letras.</span>}
            </label>
            <label className="block">
              <span className="text-[12px] font-semibold text-[var(--ls-t3)]">Fase</span>
              <select className={`${CAMPO_AGENTE} mt-1`} value={fase} onChange={(e) => setFase(e.target.value as Fase)}>
                <option value="sin-cambio">Sin cambiar (ahora: {editando.fase === 'lanzamiento' ? 'lanzamiento' : 'normal'})</option>
                <option value="auto">Automática (lanzamiento los {AGENTE.LANZAMIENTO_DIAS} primeros días)</option>
                <option value="lanzamiento">Lanzamiento</option>
                <option value="normal">Normal</option>
              </select>
              <span className="mt-1 block text-[12px] text-[var(--ls-t4)]">En lanzamiento el objetivo automático se multiplica por el de la ficha, no recorta salvo por stock o techo y no deshace solo.</span>
            </label>
          </div>
        )}
      </PanelLateral>

      <Confirmacion
        abierto={confirmar}
        onCambio={setConfirmar}
        titulo="¿Guardar la marca y la fase?"
        descripcion={editando ? `${editando.nombre}: el agente lo tendrá en cuenta desde su próxima pasada.` : undefined}
        palabra={null}
        tono="normal"
        textoConfirmar="Guardar"
        onConfirmar={async () => {
          if (!editando || !cambios) return
          await accion('PUT', { accion: 'producto', asin: editando.asin, ...cambios }, { exito: 'Producto guardado.' })
          setEditando(null)
        }}
      />
    </Tarjeta>
  )
}
