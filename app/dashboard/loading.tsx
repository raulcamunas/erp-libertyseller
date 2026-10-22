import { Esqueleto } from '@/components/rendimiento/ui'

/**
 * LO QUE SE VE EN EL MISMO INSTANTE DEL CLIC EN CUALQUIER PANTALLA DEL ERP que no tenga su propio `loading.tsx`.
 *
 * Sin una frontera de carga, Next no tiene nada que enseñar mientras el servidor prepara la página, y el menú se queda como si no hubiera
 * pasado nada hasta que acaba: era lo que se notaba al entrar en las pantallas más pesadas. Con ella, esto sale al pulsar y la pantalla
 * entra detrás. Es deliberadamente sobrio —un título y unos bloques—: no pretende parecerse a ninguna pantalla en concreto; las que más
 * pesan (Cold Calling) tienen el suyo.
 */
export default function CargandoPantalla() {
  return (
    <div aria-busy="true" aria-label="Cargando" className="space-y-4">
      <Esqueleto className="h-6 w-[240px]" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Esqueleto key={i} className="h-[72px]" />
        ))}
      </div>
      <Esqueleto className="h-[320px]" />
    </div>
  )
}
