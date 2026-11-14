'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, CheckCheck, CircleAlert, Info, ListChecks, RotateCcw, TriangleAlert } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { CAJA, Segmentado, TiraDeCifras } from '@/components/marketing-test/piezas'
import { entero } from '@/components/marketing-test/formato'
import { Vacio } from '@/components/plataforma/comun'
import { tareasDeLaCuenta, type Tarea } from '@/lib/seo/tareas'
import type { Gravedad } from '@/lib/seo/norma'
import { BotonCopiar, fichaDe, IrA, nombreDe } from './comun'
import type { DatosSeo } from './useCuentaSeo'

type Filtro = 'todas' | 'graves' | 'seo' | 'otros'

const GRAVEDAD: Record<Gravedad, { texto: string; color: string; Icono: typeof CircleAlert }> = {
  grave: { texto: 'Urgente', color: COLOR_ESTADO.rojo, Icono: CircleAlert },
  atencion: { texto: 'Esta semana', color: COLOR_ESTADO.ambar, Icono: TriangleAlert },
  info: { texto: 'Para tener en cuenta', color: COLOR_ESTADO.azul, Icono: Info },
}

/** Una tarea marcada como revisada se esconde 7 días; si los datos siguen igual, vuelve (para que nada se quede olvidado para siempre) */
const DIAS_REVISADA = 7
const clave = (cuentaId: string) => `seo-revisadas:${cuentaId}`

function leerRevisadas(cuentaId: string): Record<string, number> {
  try {
    const crudo = JSON.parse(window.localStorage.getItem(clave(cuentaId)) ?? '{}') as Record<string, number>
    const vigentes = Object.entries(crudo).filter(([, t]) => Date.now() - t < DIAS_REVISADA * 86_400_000)
    return Object.fromEntries(vigentes)
  } catch {
    return {}
  }
}

/**
 * QUÉ HACER HOY en esta cuenta y país: todas las tareas de SEO de sus productos, de la más urgente a la de menos impacto (lib/seo/tareas.ts), cada una con quién la hace y qué se hace según el SOP.
 * Es la pantalla con la que se empieza el día: el resto de pestañas son para profundizar en una tarea.
 *
 * «Revisada» la esconde una semana en ESTE navegador (no se guarda en la base: es una comodidad de cada persona). Si al volver los datos siguen diciendo lo mismo, vuelve a salir.
 */
export function PestanaSeoHoy({ cuentaId, datos, irA }: { cuentaId: string; datos: DatosSeo; irA: (t: 'productos' | 'busquedas' | 'ficha', asin?: string) => void }) {
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [producto, setProducto] = useState<string>('todos')
  const [revisadas, setRevisadas] = useState<Record<string, number>>({})
  const [verRevisadas, setVerRevisadas] = useState(false)

  useEffect(() => setRevisadas(leerRevisadas(cuentaId)), [cuentaId])

  const tareas = useMemo(
    () =>
      tareasDeLaCuenta({
        hoy: new Date().toISOString().slice(0, 10),
        lectura: datos.lectura,
        productos: datos.productos,
        fichas: datos.fichas,
        consultas: datos.consultas,
        evolucion: datos.evolucion,
        precios: datos.precios,
        cambios: datos.cambios,
      }),
    [datos]
  )

  const marcar = (id: string, si: boolean) =>
    setRevisadas((prev) => {
      const nuevo = { ...prev }
      if (si) nuevo[id] = Date.now()
      else delete nuevo[id]
      try {
        window.localStorage.setItem(clave(cuentaId), JSON.stringify(nuevo))
      } catch {
        /* sin almacenamiento: dura lo que la pestaña abierta */
      }
      return nuevo
    })

  const delProducto = tareas.filter((t) => producto === 'todos' || t.asin === producto)
  const pendientes = delProducto.filter((t) => !revisadas[t.id])
  const visibles = (verRevisadas ? delProducto.filter((t) => revisadas[t.id]) : pendientes).filter((t) =>
    filtro === 'todas' ? true : filtro === 'graves' ? t.gravedad === 'grave' : filtro === 'seo' ? t.quien === 'SEO' : t.quien !== 'SEO'
  )
  const nRevisadas = delProducto.length - pendientes.length
  // Lo que hay en juego: por producto, el mayor impacto de sus tareas (no se suman, que serían las mismas compras contadas varias veces)
  const enJuego = [...pendientes.reduce((m, t) => (t.asin ? m.set(t.asin, Math.max(m.get(t.asin) ?? 0, t.impacto)) : m), new Map<string, number>()).values()].reduce((s, x) => s + x, 0)

  if (datos.productos.length === 0)
    return (
      <Vacio icono={<ListChecks />} titulo="Todavía no sigues ningún producto en este país" accion={<button type="button" onClick={() => irA('productos')} className="h-[30px] rounded-[9px] bg-[var(--ls-acc-relleno)] px-3 text-[12.5px] font-semibold text-[var(--ls-acc-tinta)]">Añadir productos</button>}>
        Las tareas salen de las búsquedas de Brand Analytics y de la ficha de cada producto que sigues.
      </Vacio>
    )

  return (
    <div className="flex max-w-[1240px] flex-col gap-3 pb-8">
      <TiraDeCifras
        cifras={[
          { etiqueta: 'Urgentes', valor: entero(pendientes.filter((t) => t.gravedad === 'grave').length), nota: 'fuera de norma o caídas fuertes', color: pendientes.some((t) => t.gravedad === 'grave') ? COLOR_ESTADO.rojo : undefined },
          { etiqueta: 'Esta semana', valor: entero(pendientes.filter((t) => t.gravedad === 'atencion').length), nota: 'mejoras con impacto', color: pendientes.some((t) => t.gravedad === 'atencion') ? COLOR_ESTADO.ambar : undefined },
          { etiqueta: 'De SEO / de otros', valor: `${pendientes.filter((t) => t.quien === 'SEO').length} / ${pendientes.filter((t) => t.quien !== 'SEO').length}`, nota: 'otros: imagen, precio, Buy Box…' },
          { etiqueta: 'Compras en juego', valor: entero(enJuego), nota: 'de todo Amazon que aún no son tuyas' },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Segmentado
          etiqueta="Qué tareas"
          opciones={[
            { id: 'todas', texto: 'Todas', cuenta: (verRevisadas ? nRevisadas : pendientes.length) },
            { id: 'graves', texto: 'Urgentes' },
            { id: 'seo', texto: 'De SEO' },
            { id: 'otros', texto: 'No son de SEO' },
          ]}
          valor={filtro}
          cambiar={(v) => setFiltro(v as Filtro)}
        />
        {datos.productos.length > 1 && (
          <label className="inline-flex min-w-0 items-center gap-2">
            <span className="text-[12px] text-[var(--ls-t4)]">Producto</span>
            <select value={producto} onChange={(e) => setProducto(e.target.value)} className="h-[30px] max-w-[320px] rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[12.5px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc-graf)]">
              <option value="todos">Todos ({datos.productos.length})</option>
              {datos.productos.map((p) => (
                <option key={p.id} value={p.asin}>
                  {nombreDe(p, fichaDe(datos, p.asin)).slice(0, 60)}
                </option>
              ))}
            </select>
          </label>
        )}
        {nRevisadas > 0 && (
          <button type="button" onClick={() => setVerRevisadas((v) => !v)} className="ml-auto inline-flex h-[30px] items-center gap-[6px] rounded-[9px] px-[10px] text-[12px] font-medium text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">
            <CheckCheck className="h-[13px] w-[13px]" /> {verRevisadas ? 'Ver las pendientes' : `Ver revisadas (${nRevisadas})`}
          </button>
        )}
      </div>

      {datos.lectura.acceso !== 'si' && datos.consultas.MONTH.length === 0 && datos.consultas.WEEK.length === 0 && (
        <p className="rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-[9px] text-[12px] text-[var(--ls-t3)]">
          {datos.lectura.acceso === 'no'
            ? 'Sin acceso a Brand Analytics en esta cuenta: solo salen las tareas de la ficha (norma de 2026). Las del embudo y las búsquedas necesitan el informe.'
            : 'Las búsquedas de Brand Analytics aún no han llegado: de momento solo salen las tareas de la ficha. La pantalla se actualiza sola.'}
        </p>
      )}

      {visibles.length === 0 ? (
        <div className={`${CAJA.base} flex items-center gap-3 px-4 py-5`}>
          <CheckCheck className="h-5 w-5 shrink-0" style={{ color: COLOR_ESTADO.verde }} />
          <div>
            <div className="text-[13.5px] font-semibold text-[var(--ls-t1)]">{verRevisadas ? 'No hay tareas revisadas' : filtro === 'todas' ? 'Nada pendiente en este país' : 'Nada pendiente con este filtro'}</div>
            <div className="text-[12px] text-[var(--ls-t3)]">{verRevisadas ? '' : 'Las tareas salen solas cuando los datos de Amazon dicen que algo se puede mejorar. Vuelve mañana o mira «Búsquedas» para profundizar.'}</div>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {visibles.map((t) => (
            <FilaDeTarea key={t.id} t={t} revisada={!!revisadas[t.id]} marcar={(si) => marcar(t.id, si)} irA={irA} />
          ))}
        </ul>
      )}

      <p className="flex items-start gap-2 text-[11px] leading-[1.5] text-[var(--ls-t4)]">
        <CalendarClock className="mt-[2px] h-3 w-3 shrink-0" />
        SOP: los cambios de ficha se aplican en la semana sin pujas (S3), con firma y fecha y guardando el texto anterior; nunca la misma semana que un ajuste de pujas. Como mucho un cambio de título cada 30 días por producto, y 21 días antes de juzgarlo.
      </p>
    </div>
  )
}

function FilaDeTarea({ t, revisada, marcar, irA }: { t: Tarea; revisada: boolean; marcar: (si: boolean) => void; irA: (tab: 'productos' | 'busquedas' | 'ficha', asin?: string) => void }) {
  const g = GRAVEDAD[t.gravedad]
  const bloqueada = t.bloqueadaHasta ? new Date(`${t.bloqueadaHasta}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', timeZone: 'UTC' }) : null
  return (
    <li className={`${CAJA.base} flex gap-3 px-4 py-3 ${revisada ? 'opacity-60' : ''}`} style={{ borderLeft: `3px solid ${g.color}` }}>
      <g.Icono className="mt-[2px] h-[15px] w-[15px] shrink-0" style={{ color: g.color }} aria-label={g.texto} />
      <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="min-w-0 text-[13.5px] font-semibold leading-[1.35] text-[var(--ls-t1)]">{t.titulo}</h3>
          {t.impacto > 0 && <span className="text-[11.5px] tabular-nums text-[var(--ls-t4)]" title="Compras de todo Amazon en las búsquedas afectadas que aún no son tuyas. Sirve para ordenar, no es una promesa de ventas">{entero(t.impacto)} compras en juego</span>}
        </div>
        <p className="text-[12.5px] leading-[1.5] text-[var(--ls-t3)]">{t.detalle}</p>
        <p className="text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">
          <span className="font-semibold text-[var(--ls-t1)]">Qué hacer: </span>
          {t.accion}
        </p>
        {t.etiquetas && t.etiquetas.length > 0 && (
          <div className="flex flex-wrap items-center gap-[5px]">
            {t.etiquetas.map((e) => (
              <span key={e} className="rounded-[6px] bg-[var(--ls-sup2)] px-[7px] py-[2px] text-[11.5px] font-medium text-[var(--ls-t1)]">{e}</span>
            ))}
            <BotonCopiar texto={t.etiquetas.join(t.tipo === 'palabras' ? ' ' : '\n')} compacto />
          </div>
        )}
        <div className="mt-[2px] flex flex-wrap items-center gap-2">
          <span className="inline-flex h-[22px] items-center rounded-full px-[9px] text-[11px] font-semibold" style={t.quien === 'SEO' ? { color: 'var(--ls-acc)', background: 'color-mix(in srgb, var(--ls-acc) 12%, transparent)' } : { color: 'var(--ls-t2)', background: 'var(--ls-sup2)' }}>
            {t.quien === 'SEO' ? 'Trabajo de SEO' : `Le toca a: ${t.quien}`}
          </span>
          {bloqueada && (
            <span className="inline-flex h-[22px] items-center gap-[5px] rounded-full px-[9px] text-[11px] font-medium" style={{ color: COLOR_ESTADO.ambar, background: `color-mix(in srgb, ${COLOR_ESTADO.ambar} 12%, transparent)` }} title="La ficha se cambió hace menos de 30 días: el SOP no deja volver a tocar el título antes">
              <CalendarClock className="h-3 w-3" /> No tocar el título hasta el {bloqueada}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1">
            {t.ir && t.asin && <IrA texto={t.ir === 'ficha' ? 'Ver ficha' : t.ir === 'busquedas' ? 'Ver búsquedas' : 'Ver productos'} onClick={() => irA(t.ir as 'productos' | 'busquedas' | 'ficha', t.asin ?? undefined)} />}
            <button type="button" onClick={() => marcar(!revisada)} className="inline-flex h-[28px] items-center gap-[5px] rounded-[8px] border border-[var(--ls-linea)] px-[9px] text-[12px] font-medium text-[var(--ls-t2)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]" title={revisada ? 'Volver a ponerla pendiente' : `Esconderla ${DIAS_REVISADA} días en este navegador`}>
              {revisada ? <RotateCcw className="h-3 w-3" /> : <CheckCheck className="h-3 w-3" />} {revisada ? 'Pendiente' : 'Revisada'}
            </button>
          </span>
        </div>
      </div>
    </li>
  )
}
