import { Esqueleto } from '@/components/rendimiento/ui'
import { REJILLA } from '@/lib/agenda/colocar'

/**
 * LO QUE SE VE EN EL MISMO INSTANTE DEL CLIC EN «AGENDA»: la barra y la rejilla con su forma, sin citas.
 *
 * Hasta ahora el clic no hacía nada visible hasta que el servidor acababa de leer las 5.939 citas (casi dos segundos); con esto sale al pulsar y las citas entran detrás.
 * Tiene las mismas medidas que la agenda de verdad (cabecera de 56 px, horas de 64) para que al llegar los datos no se mueva nada.
 */
export function EsqueletoDeAgenda() {
  const horas = REJILLA.finDia - REJILLA.inicioDia
  return (
    <div className="flex h-[calc(100dvh-8rem)] min-w-0 flex-col gap-2.5 lg:h-[calc(100vh-4rem)]" aria-busy="true" aria-label="Cargando la agenda">
      <div className="flex shrink-0 flex-col gap-2">
        <div className="flex items-center gap-2">
          <Esqueleto className="h-5 w-[150px]" />
          <Esqueleto className="h-7 w-[104px]" />
          <Esqueleto className="h-5 w-[170px]" />
          <span className="flex-1" />
          <Esqueleto className="hidden h-7 w-[92px] sm:block" />
          <Esqueleto className="h-7 w-[104px]" />
        </div>
        <div className="flex items-center gap-1.5">
          {['w-[78px]', 'w-[70px]', 'w-[64px]', 'w-[72px]', 'w-[112px]', 'w-[118px]'].map((ancho) => (
            <Esqueleto key={ancho} className={`h-6 ${ancho}`} />
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
        <div className="grid h-[58px] border-b border-[var(--ls-linea2)] bg-[var(--ls-sup2)]" style={{ gridTemplateColumns: '56px repeat(7, minmax(0, 1fr))' }}>
          <div />
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="flex flex-col items-center justify-center gap-1 border-l border-[var(--ls-linea)]">
              <Esqueleto className="h-2.5 w-7" />
              <Esqueleto className="h-5 w-5 !rounded-full" />
            </div>
          ))}
        </div>
        <div className="grid" style={{ gridTemplateColumns: '56px repeat(7, minmax(0, 1fr))' }}>
          <div className="relative">
            {Array.from({ length: horas }, (_, i) => (
              <span key={i} className="block text-right text-[10.5px] tabular-nums text-[var(--ls-t4)]" style={{ height: REJILLA.alturaHora, paddingRight: 8 }}>
                {String(REJILLA.inicioDia + i).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          {Array.from({ length: 7 }, (_, i) => (
            <div
              key={i}
              className="border-l border-[var(--ls-linea)]"
              style={{
                height: horas * REJILLA.alturaHora,
                backgroundImage: 'linear-gradient(to bottom, var(--ls-linea) 0, var(--ls-linea) 1px, transparent 1px)',
                backgroundSize: `100% ${REJILLA.alturaHora}px`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
