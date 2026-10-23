/**
 * «Chrome · macOS» A PARTIR DE LA HUELLA DEL NAVEGADOR. PURO. Se prueba en agente.prueba.ts.
 *
 * Solo para que quien mira vea de un vistazo con qué se abrió el ERP (un ordenador distinto al de siempre llama la
 * atención). No es una identificación fina: el orden de las comprobaciones importa porque casi todos se llaman «Chrome».
 */
export function resumenDeAgente(agente: string | null | undefined): string | null {
  if (!agente) return null
  const ua = agente

  // El navegador: Edge, Opera y Samsung dicen también «Chrome», y Chrome dice «Safari»
  const navegador = /Edg(?:e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /SamsungBrowser\//.test(ua)
        ? 'Samsung Internet'
        : /Firefox\/|FxiOS\//.test(ua)
          ? 'Firefox'
          : /CriOS\/|Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : null

  // El sistema: iPhone y iPad dicen «like Mac OS X», y Android dice «Linux»
  const sistema = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : null

  if (!navegador && !sistema) return null
  return [navegador, sistema].filter(Boolean).join(' · ')
}
