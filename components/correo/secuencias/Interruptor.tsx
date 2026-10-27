'use client'

/** Un interruptor con su título y una explicación debajo. Lo usan los ajustes de Secuencias (el motor, la IA, la verificación de direcciones) */
export function Interruptor({ titulo, texto, activo, desactivado, onCambio }: { titulo: string; texto: string; activo: boolean; desactivado: boolean; onCambio: (v: boolean) => void }) {
  return (
    <div className={`flex items-start gap-3 ${desactivado ? 'opacity-60' : ''}`}>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-[var(--ls-t1)]">{titulo}</p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--ls-t3)]">{texto}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={activo}
        aria-label={titulo}
        disabled={desactivado}
        onClick={() => onCambio(!activo)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors disabled:cursor-default ${activo ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-relleno)]' : 'border-[var(--ls-linea2)] bg-[var(--ls-sup3)]'}`}
      >
        <span className={`absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200 ${activo ? 'translate-x-4' : ''}`} aria-hidden />
      </button>
    </div>
  )
}
