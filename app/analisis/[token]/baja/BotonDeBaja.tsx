'use client'

import { useState } from 'react'

export function BotonDeBaja({ token }: { token: string }) {
  const [estado, setEstado] = useState<'listo' | 'enviando' | 'hecho' | 'error'>('listo')
  if (estado === 'hecho') return <p style={{ color: '#FF8A3D', fontWeight: 700, fontSize: 15, margin: 0 }}>Hecho. No recibirás más correos nuestros.</p>
  return (
    <>
      <button
        type="button"
        disabled={estado === 'enviando'}
        onClick={async () => {
          setEstado('enviando')
          const r = await fetch('/api/analisis/baja', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) }).catch(() => null)
          setEstado(r?.ok ? 'hecho' : 'error')
        }}
        style={{ width: '100%', padding: '14px 18px', background: '#FF6600', color: '#fff', border: 0, borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: 'pointer', opacity: estado === 'enviando' ? 0.6 : 1 }}
      >
        {estado === 'enviando' ? 'Un momento…' : 'Confirmar la baja'}
      </button>
      {estado === 'error' && <p style={{ color: '#F87171', fontSize: 13, marginTop: 10 }}>No se ha podido guardar. Vuelve a probar en un momento.</p>}
    </>
  )
}
