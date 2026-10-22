import { EsqueletoDeCartera } from '@/components/cold-calling/EsqueletoDeCartera'

/**
 * LO QUE SE VE EN EL MISMO INSTANTE DEL CLIC EN «COLD CALLING».
 *
 * Sin este fichero Next no tiene nada que enseñar mientras el servidor prepara la página, y el menú se queda como si no hubiera pasado
 * nada hasta que acaba. Con él, el esqueleto se prepara con antelación y aparece al pulsar; la cartera entra después, sin que nada salte.
 */
export default function CargandoColdCalling() {
  return (
    <div className="flex h-[calc(100dvh-8rem)] min-w-0 flex-col lg:h-[calc(100vh-4rem)]">
      <EsqueletoDeCartera />
    </div>
  )
}
