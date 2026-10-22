import { Esqueleto } from '@/components/rendimiento/ui'

/**
 * LO QUE SE VE AL INSTANTE MIENTRAS LLEGAN LOS LEADS.
 *
 * Clicar «Cold Calling» en el menú tardaba: la página pedía la cartera entera al servidor y hasta que acababa no se pintaba nada, ni
 * siquiera un aviso de que se estaba cargando. Esto es lo que enseña `loading.tsx` en el mismo instante del clic y lo que enseña la
 * página mientras sus datos llegan: la misma forma que tendrá la pantalla (cifras, filtros, lista y ficha) con un brillo que pasa por
 * encima, de modo que cuando llegan los datos nada salta de sitio.
 *
 * No lleva JavaScript propio ni nada que dependa de datos: se pinta en el servidor y llega con la primera respuesta.
 */

export function EsqueletoDeCartera() {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-2.5" aria-busy="true" aria-label="Cargando Cold Calling">
      {/* Título y cifras */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-[17px] font-semibold tracking-[-0.012em] text-[var(--ls-t1)]">Cold Calling</h1>
        <Esqueleto className="h-7 w-[430px] max-w-full" />
        <span className="ml-auto flex gap-2">
          <Esqueleto className="h-7 w-[150px]" />
          <Esqueleto className="h-7 w-[250px]" />
        </span>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Esqueleto className="h-6 w-[150px]" />
        {Array.from({ length: 8 }, (_, i) => (
          <Esqueleto key={i} className="h-6 w-[58px]" />
        ))}
      </div>

      {/* Lista y ficha */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
        <div className="min-h-0 overflow-hidden rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
          <div className="border-b border-[var(--ls-linea)] p-2.5">
            <Esqueleto className="h-[28px]" />
          </div>
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="flex h-[52px] items-center gap-2.5 border-b border-[var(--ls-linea)] px-3">
              <Esqueleto className="h-[15px] w-[15px] rounded-full" />
              <span className="flex-1 space-y-1.5">
                <Esqueleto className="h-[11px] w-[70%]" />
                <Esqueleto className="h-[9px] w-[50%]" />
              </span>
            </div>
          ))}
        </div>
        <div className="hidden min-h-0 overflow-hidden rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-4 lg:block">
          <Esqueleto className="h-5 w-[320px]" />
          <Esqueleto className="mt-2 h-3 w-[240px]" />
          <div className="mt-3 flex gap-2">
            <Esqueleto className="h-8 w-[170px]" />
            <Esqueleto className="h-8 w-[200px]" />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {Array.from({ length: 7 }, (_, i) => (
              <Esqueleto key={i} className="h-[26px] w-[110px]" />
            ))}
          </div>
          <div className="mt-5 grid grid-cols-[minmax(0,1fr)_300px] gap-5">
            <div className="space-y-3">
              <Esqueleto className="h-[96px]" />
              <Esqueleto className="h-4 w-[80%]" />
              <Esqueleto className="h-4 w-[65%]" />
              <Esqueleto className="h-4 w-[72%]" />
            </div>
            <div className="space-y-2">
              {Array.from({ length: 8 }, (_, i) => (
                <Esqueleto key={i} className="h-3.5" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
