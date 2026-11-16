'use client'

import { useMemo, useState } from 'react'
import { Ban, Copy, Download, Eye, PackageX, Ruler, Warehouse } from 'lucide-react'
import { toast } from 'sonner'
import { Boton } from '@/components/ui-ls/Boton'
import { Confirmacion } from '@/components/ui-ls/Confirmacion'
import { EstadoVacio } from '@/components/ui-ls/EstadoVacio'
import { Insignia } from '@/components/ui-ls/Insignia'
import { Segmentado, type Opcion } from '@/components/ui-ls/Pestanas'
import { Tarjeta } from '@/components/ui-ls/Tarjeta'
import type { TonoEstado } from '@/lib/estilo/denso'
import type { AjustesReposicion, LineaPlan } from '@/lib/fba/plan-tipos'
import { dias, diasEntre, dinero, entero, fechaCorta, ritmo, unidades } from '../formato'
import { guardarAjusteSku } from './AjustesSku'
import { TEXTO_ACCION_EXCESO, gruposDeAtencion, preguntaAgotado, type AccionExceso, type FilaExceso } from './calculos'

/**
 * LO QUE HAY QUE MIRAR APARTE DEL PLAN (spec remesas-pro §1.5, D2, D5.2, D8 y D16; paquete C5).
 *
 * Cuatro grupos, en un selector con su cuenta (se abre el primero que tenga algo):
 *   Agotados: ¿se repone?   agotados hace tiempo (motivo `agotado_largo`): el plan no los propone solos. Se pregunta al
 *                           cliente («Copiar pregunta») o se sacan del plan como descatalogados (PUT reposicion-sku
 *                           `excluir: true`, con confirmación).
 *   Exceso                  cubren más que la cobertura máxima: días, unidades sobrantes, almacenaje estimado del mes
 *                           (`almacenaje.ts`, en €) y la acción sugerida (no enviar, promoción, retirada). Sin avisos al chat.
 *   Entrante sin remesa     Amazon tiene unidades entrantes que no están en ninguna remesa del ERP: «Importar».
 *   Tallas sin ventas       por modelo, las tallas con 0 ventas en 180 días (cuota 0 en el reparto) y el stock parado en ellas.
 *
 * Las listas largas enseñan 8 y «Ver todas»: nada se anima fila a fila.
 *
 * API
 *   <GruposDeAtencion lineas ajustes hoy clienteId clienteNombre puedeEditar onImportarPedidos onElegirSku? alCambiar? />
 */

export interface GruposDeAtencionProps {
  lineas: readonly LineaPlan[]
  ajustes: Pick<AjustesReposicion, 'coberturaMaxima'>
  hoy: string
  clienteId: string
  clienteNombre: string
  puedeEditar: boolean
  onImportarPedidos: (clienteId: string) => void
  /** Abre la referencia en la tabla del plan */
  onElegirSku?: (sku: string) => void
  /** Tras sacar una referencia del plan */
  alCambiar?: () => void
  className?: string
}

type IdGrupo = 'agotados' | 'exceso' | 'entrante' | 'tallas'

const MAX_VISIBLES = 8

const TONO_ACCION: Record<AccionExceso, TonoEstado> = { retirada: 'rojo', promocion: 'ambar', no_enviar: 'azul' }

async function copiar(texto: string, exito: string) {
  try {
    await navigator.clipboard.writeText(texto)
    toast.success(exito)
  } catch {
    toast.error('No se ha podido copiar: selecciona el texto y cópialo a mano')
  }
}

export function GruposDeAtencion({ lineas, ajustes, hoy, clienteId, clienteNombre, puedeEditar, onImportarPedidos, onElegirSku, alCambiar, className }: GruposDeAtencionProps) {
  const grupos = useMemo(() => gruposDeAtencion(lineas, ajustes, hoy), [lineas, ajustes, hoy])
  const cuentas: Record<IdGrupo, number> = {
    agotados: grupos.agotados.length,
    exceso: grupos.exceso.length,
    entrante: grupos.entrante.length,
    tallas: grupos.tallas.length,
  }
  const primero = (['agotados', 'exceso', 'entrante', 'tallas'] as const).find((g) => cuentas[g] > 0) ?? 'agotados'
  const [elegido, setElegido] = useState<IdGrupo | null>(null)
  const grupo = elegido ?? primero
  const [todas, setTodas] = useState(false)
  const [descatalogar, setDescatalogar] = useState<LineaPlan | null>(null)

  const opciones: Array<Opcion<IdGrupo>> = [
    { id: 'agotados', texto: 'Agotados', icono: PackageX, cuenta: cuentas.agotados },
    { id: 'exceso', texto: 'Exceso', icono: Warehouse, cuenta: cuentas.exceso },
    { id: 'entrante', texto: 'Entrante sin remesa', icono: Download, cuenta: cuentas.entrante },
    { id: 'tallas', texto: 'Tallas sin ventas', icono: Ruler, cuenta: cuentas.tallas },
  ]
  const total = cuentas.agotados + cuentas.exceso + cuentas.entrante + cuentas.tallas
  const almacenajeMes = grupos.exceso.reduce((s, x) => s + x.costeMes, 0)

  return (
    <Tarjeta
      titulo="Para mirar aparte"
      subtitulo={total === 0 ? 'Nada fuera de lo normal' : `${entero(total)} ${total === 1 ? 'cosa' : 'cosas'} que el plan no resuelve solo`}
      icono={Eye}
      acento="remesas"
      className={className}
      cuerpoClassName="min-w-0"
    >
      {total === 0 ? (
        <EstadoVacio compacto acento="remesas" titulo="Todo en orden" descripcion="Ni agotados largos, ni exceso, ni entrantes sin remesa, ni tallas paradas." />
      ) : (
        <div className="min-w-0 space-y-3">
          <Segmentado
            etiqueta="Grupos de atención"
            opciones={opciones}
            valor={grupo}
            onCambio={(g) => {
              setElegido(g)
              setTodas(false)
            }}
            tamano="sm"
            className="w-full"
          />

          {grupo === 'agotados' && (
            <Grupo
              vacio="Ninguna referencia lleva tanto tiempo agotada."
              explicacion="Llevan mucho tiempo sin stock. El plan no las propone solas: pregunta al cliente si las repone o sácalas del plan."
              filas={grupos.agotados}
              todas={todas}
              onTodas={() => setTodas(true)}
              pintar={(l) => (
                <FilaAgotado
                  key={l.sku}
                  linea={l}
                  hoy={hoy}
                  puedeEditar={puedeEditar}
                  onCopiar={() => void copiar(preguntaAgotado(l, clienteNombre, hoy), 'Pregunta copiada: pégasela al cliente')}
                  onDescatalogar={() => setDescatalogar(l)}
                  onVer={onElegirSku ? () => onElegirSku(l.sku) : undefined}
                />
              )}
            />
          )}

          {grupo === 'exceso' && (
            <Grupo
              vacio={`Nada cubre más de ${entero(ajustes.coberturaMaxima)} días.`}
              explicacion={
                <>
                  Cubren más de {entero(ajustes.coberturaMaxima)} días (la cobertura máxima). Lo que sobra cuesta unos{' '}
                  <b className="text-[var(--ls-t1)]">{dinero(almacenajeMes, 'EUR', almacenajeMes < 10 ? 2 : 0)}</b> de almacenaje este mes (estimado).
                </>
              }
              filas={grupos.exceso}
              todas={todas}
              onTodas={() => setTodas(true)}
              pintar={(x) => <FilaDeExceso key={x.sku} fila={x} onVer={onElegirSku ? () => onElegirSku(x.sku) : undefined} />}
            />
          )}

          {grupo === 'entrante' && (
            <Grupo
              vacio="Todo lo que Amazon tiene entrante está en alguna remesa."
              explicacion="Amazon tiene unidades entrantes que no están en ninguna remesa del ERP. El plan ya las cuenta como de camino; importa el envío para seguirlo."
              accion={
                <Boton tamano="sm" variante="secundario" icono={Download} onClick={() => onImportarPedidos(clienteId)}>
                  Importar pedidos
                </Boton>
              }
              filas={grupos.entrante}
              todas={todas}
              onTodas={() => setTodas(true)}
              pintar={(l) => (
                <FilaSimple
                  key={l.sku}
                  sku={l.sku}
                  nombre={l.nombre}
                  onVer={onElegirSku ? () => onElegirSku(l.sku) : undefined}
                  derecha={<Insignia tono="ambar" tamano="sm">{unidades(l.entranteSinRemesa)} sin remesa</Insignia>}
                  detalle={`Amazon tiene ${entero(l.entranteSinRemesa)} ud entrantes que no están en el ERP${l.deCamino > l.entranteSinRemesa ? ` (y ${entero(l.deCamino - l.entranteSinRemesa)} de remesas)` : ''}.`}
                  boton={
                    <Boton tamano="sm" variante="fantasma" icono={Download} onClick={() => onImportarPedidos(clienteId)}>
                      Importar
                    </Boton>
                  }
                />
              )}
            />
          )}

          {grupo === 'tallas' && (
            <Grupo
              vacio="Todas las tallas de sus modelos han vendido algo en 180 días."
              explicacion="Tallas sin ninguna venta en 180 días: el reparto por tallas les da cuota 0 y no se proponen. Lo que tienen en Amazon está parado."
              filas={grupos.tallas}
              todas={todas}
              onTodas={() => setTodas(true)}
              pintar={(t) => (
                <li key={t.modelo} className="min-w-0 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-[10px]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[13px] font-semibold text-[var(--ls-t1)]">{t.modelo}</span>
                    <span className="text-[12px] tabular-nums text-[var(--ls-t3)]">{t.vendibles > 0 ? `${unidades(t.vendibles)} paradas` : 'sin stock en Amazon'}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-[6px]">
                    {t.tallas.map((l) => (
                      <button
                        key={l.sku}
                        type="button"
                        onClick={onElegirSku ? () => onElegirSku(l.sku) : undefined}
                        disabled={!onElegirSku}
                        title={`${l.sku}: ${unidades(l.vendibles)} en Amazon`}
                        className="inline-flex h-7 items-center gap-1 rounded-full border border-[var(--ls-linea2)] px-[10px] text-[12px] text-[var(--ls-t2)] hover:bg-[var(--ls-sup3)] disabled:cursor-default max-lg:h-9"
                      >
                        <b className="font-semibold text-[var(--ls-t1)]">{l.talla ?? l.sku}</b>
                        <span className="tabular-nums text-[var(--ls-t4)]">· {entero(l.vendibles)}</span>
                      </button>
                    ))}
                  </div>
                </li>
              )}
            />
          )}
        </div>
      )}

      <Confirmacion
        abierto={descatalogar !== null}
        onCambio={(a) => !a && setDescatalogar(null)}
        titulo={descatalogar ? `¿Sacar ${descatalogar.sku} del plan?` : ''}
        descripcion="Queda como descatalogada: el plan no la vuelve a proponer. Se puede deshacer en los ajustes de la referencia (Sacar del plan)."
        palabra={null}
        tono="normal"
        textoConfirmar="Sí, no se repone"
        onConfirmar={async () => {
          if (!descatalogar) return
          const r = await guardarAjusteSku(clienteId, { sku: descatalogar.sku, excluir: true, motivo: 'Descatalogada: el cliente no la repone' })
          if (!r.ok) {
            toast.error(r.error)
            throw new Error(r.error)
          }
          toast.success(`${descatalogar.sku} fuera del plan. Se nota al recalcular.`)
          alCambiar?.()
        }}
      />
    </Tarjeta>
  )
}

/* ------------------------------------------------------------------ */

function Grupo<T>({
  explicacion,
  vacio,
  accion,
  filas,
  todas,
  onTodas,
  pintar,
}: {
  explicacion: React.ReactNode
  vacio: string
  accion?: React.ReactNode
  filas: readonly T[]
  todas: boolean
  onTodas: () => void
  pintar: (f: T) => React.ReactNode
}) {
  if (filas.length === 0) return <p className="py-4 text-center text-[12.5px] text-[var(--ls-t3)]">{vacio}</p>
  const visibles = todas ? filas : filas.slice(0, MAX_VISIBLES)
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-[12px] leading-[1.5] text-[var(--ls-t3)]">{explicacion}</p>
        {accion}
      </div>
      <ul className="min-w-0 space-y-2">{visibles.map(pintar)}</ul>
      {!todas && filas.length > MAX_VISIBLES && (
        <div className="flex justify-center">
          <Boton tamano="sm" variante="fantasma" onClick={onTodas}>
            Ver todas ({entero(filas.length)})
          </Boton>
        </div>
      )}
    </div>
  )
}

function Cabeza({ sku, nombre, onVer }: { sku: string; nombre: string | null; onVer?: () => void }) {
  const contenido = (
    <>
      <span className="block truncate text-[13px] font-semibold text-[var(--ls-t1)]">{sku}</span>
      {nombre && <span className="block truncate text-[11.5px] text-[var(--ls-t4)]">{nombre}</span>}
    </>
  )
  return onVer ? (
    <button type="button" onClick={onVer} className="min-w-0 flex-1 rounded-[6px] text-left hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ls-acc-graf)]" title="Ver en la tabla del plan">
      {contenido}
    </button>
  ) : (
    <div className="min-w-0 flex-1">{contenido}</div>
  )
}

function FilaSimple({ sku, nombre, derecha, detalle, boton, onVer }: { sku: string; nombre: string | null; derecha?: React.ReactNode; detalle?: React.ReactNode; boton?: React.ReactNode; onVer?: () => void }) {
  return (
    <li className="min-w-0 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-[10px]">
      <div className="flex min-w-0 items-start gap-2">
        <Cabeza sku={sku} nombre={nombre} onVer={onVer} />
        {derecha}
      </div>
      {(detalle || boton) && (
        <div className="mt-[6px] flex flex-wrap items-center justify-between gap-2">
          {detalle && <p className="min-w-0 flex-1 text-[12px] leading-[1.5] text-[var(--ls-t3)]">{detalle}</p>}
          {boton}
        </div>
      )}
    </li>
  )
}

function FilaAgotado({
  linea: l,
  hoy,
  puedeEditar,
  onCopiar,
  onDescatalogar,
  onVer,
}: {
  linea: LineaPlan
  hoy: string
  puedeEditar: boolean
  onCopiar: () => void
  onDescatalogar: () => void
  onVer?: () => void
}) {
  const desde = l.ritmo.ultimoPeriodoHasta
  const sinStock = desde ? Math.max(0, diasEntre(desde, hoy)) : null
  return (
    <FilaSimple
      sku={l.sku}
      nombre={l.nombre}
      onVer={onVer}
      derecha={
        <Insignia tono="rojo" tamano="sm" variante="contorno">
          {sinStock !== null ? `${dias(sinStock)} sin stock` : 'Agotado'}
        </Insignia>
      }
      detalle={
        <>
          {desde ? `Agotado desde el ${fechaCorta(desde, hoy)}` : 'Agotado hace tiempo'}
          {l.ritmo.base ? `; antes vendía ${ritmo(l.ritmo.base)} (~${entero(l.ritmo.base * 30)} al mes)` : ''}.
        </>
      }
      boton={
        <div className="flex flex-wrap gap-1">
          <Boton tamano="sm" variante="fantasma" icono={Copy} onClick={onCopiar} title="Copia un mensaje para preguntar al cliente si lo repone">
            Copiar pregunta
          </Boton>
          {puedeEditar && (
            <Boton tamano="sm" variante="fantasma" icono={Ban} onClick={onDescatalogar} title="Sacarla del plan: el cliente no la repone">
              Descatalogada
            </Boton>
          )}
        </div>
      }
    />
  )
}

function FilaDeExceso({ fila: x, onVer }: { fila: FilaExceso; onVer?: () => void }) {
  return (
    <li className="min-w-0 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-[10px]">
      <div className="flex min-w-0 items-start gap-2">
        <Cabeza sku={x.sku} nombre={x.nombre} onVer={onVer} />
        <Insignia tono={TONO_ACCION[x.accion]} tamano="sm">
          {TEXTO_ACCION_EXCESO[x.accion]}
        </Insignia>
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
        <Dato titulo="Dura" valor={x.dias === Infinity ? 'no vende' : dias(x.dias)} />
        <Dato titulo="Sobran" valor={unidades(x.sobrantes)} />
        <Dato titulo="Almacenaje/mes" valor={dinero(x.costeMes, 'EUR', x.costeMes < 10 ? 2 : 0)} titulo2="Estimado con los supuestos de almacenaje de Amazon de este mes" />
      </dl>
      <p className="mt-[6px] text-[12px] leading-[1.5] text-[var(--ls-t3)]">{x.porque}</p>
    </li>
  )
}

function Dato({ titulo, valor, titulo2 }: { titulo: string; valor: string; titulo2?: string }) {
  return (
    <div className="min-w-0" title={titulo2}>
      <dt className="truncate text-[10.5px] font-semibold uppercase tracking-[0.04em] text-[var(--ls-t4)]">{titulo}</dt>
      <dd className="truncate font-semibold tabular-nums text-[var(--ls-t1)]">{valor}</dd>
    </div>
  )
}
