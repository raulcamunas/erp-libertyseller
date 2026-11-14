'use client'

/** «Guardar en PDF»: el diálogo de imprimir del navegador, que ya trae «Guardar como PDF». El informe lleva su hoja de estilos de impresión (A4) */
export function BotonImprimir({ texto = 'Guardar en PDF' }: { texto?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      style={{ background: '#141414', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, Arial, sans-serif' }}
    >
      {texto}
    </button>
  )
}
