'use client'

import { cn } from '@/lib/utils'

interface MarkdownRendererProps {
  content: string
  className?: string
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  // Función para parsear markdown básico
  const parseMarkdown = (text: string) => {
    // Dividir por líneas
    const lines = text.split('\n')
    const elements: JSX.Element[] = []
    let currentList: string[] = []
    let inList = false

    lines.forEach((line, index) => {
      const trimmed = line.trim()

      // Headers con emojis
      if (trimmed.match(/^[🩸🚀⚖️]/)) {
        if (inList && currentList.length > 0) {
          elements.push(
            <ul key={`list-${index}`} className="list-none space-y-2 mb-4">
              {currentList.map((item, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-[#FF6600] mt-1">•</span>
                  <span className="text-white/80">{item}</span>
                </li>
              ))}
            </ul>
          )
          currentList = []
          inList = false
        }
        elements.push(
          <h3 key={`header-${index}`} className="text-xl font-bold text-white mt-6 mb-3">
            {trimmed}
          </h3>
        )
        return
      }

      // Bold text
      if (trimmed.match(/\*\*.*\*\*/)) {
        if (inList && currentList.length > 0) {
          elements.push(
            <ul key={`list-${index}`} className="list-none space-y-2 mb-4">
              {currentList.map((item, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-[#FF6600] mt-1">•</span>
                  <span className="text-white/80">{item}</span>
                </li>
              ))}
            </ul>
          )
          currentList = []
          inList = false
        }
        // Se escapa ANTES de meter las negritas, porque el resultado va a un
        // dangerouslySetInnerHTML (línea de abajo) y el texto NO es nuestro.
        //
        // QUÉ IMPIDE: un XSS con el texto que devuelve /api/marketing/ai-insights,
        // que incorpora términos de búsqueda y nombres de campaña sacados de los
        // CSV de Amazon Ads que se suben. Ese texto el ERP no lo controla.
        //
        // LO QUE COLABA ANTES (reproducido en node con la transformación literal
        // de esta línea): con la entrada
        //     **Resumen** <img src=x onerror=alert(document.cookie)>
        // el __html de salida conservaba el `<img onerror>` INTACTO, porque el
        // replace solo toca los `**`. La cookie de sesión de @supabase/ssr es
        // httpOnly:false, así que el script se la lleva.
        //
        // POR QUÉ NO CAMBIA NADA VISIBLE: se sigue viendo negrita donde había
        // `**` y texto plano en el resto. Lo único que cambia es que un `<` se
        // pinta como `<` en vez de abrir una etiqueta.
        const seguro = trimmed
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
        const boldText = seguro.replace(/\*\*(.*?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
        elements.push(
          <p
            key={`bold-${index}`}
            className="text-white/90 mb-3"
            dangerouslySetInnerHTML={{ __html: boldText }}
          />
        )
        return
      }

      // List items
      if (trimmed.match(/^[-•*]\s/)) {
        inList = true
        currentList.push(trimmed.replace(/^[-•*]\s/, ''))
        return
      }

      // Regular paragraphs
      if (trimmed.length > 0) {
        if (inList && currentList.length > 0) {
          elements.push(
            <ul key={`list-${index}`} className="list-none space-y-2 mb-4">
              {currentList.map((item, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-[#FF6600] mt-1">•</span>
                  <span className="text-white/80">{item}</span>
                </li>
              ))}
            </ul>
          )
          currentList = []
          inList = false
        }
        if (trimmed.length > 0 && !trimmed.match(/^[🩸🚀⚖️]/)) {
          elements.push(
            <p key={`para-${index}`} className="text-white/80 mb-3 leading-relaxed">
              {trimmed}
            </p>
          )
        }
      } else {
        // Empty line - close list if open
        if (inList && currentList.length > 0) {
          elements.push(
            <ul key={`list-${index}`} className="list-none space-y-2 mb-4">
              {currentList.map((item, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-[#FF6600] mt-1">•</span>
                  <span className="text-white/80">{item}</span>
                </li>
              ))}
            </ul>
          )
          currentList = []
          inList = false
        }
      }
    })

    // Cerrar lista si queda abierta
    if (inList && currentList.length > 0) {
      elements.push(
        <ul key="list-final" className="list-none space-y-2 mb-4">
          {currentList.map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-[#FF6600] mt-1">•</span>
              <span className="text-white/80">{item}</span>
            </li>
          ))}
        </ul>
      )
    }

    return elements
  }

  return (
    <div className={cn('prose prose-invert max-w-none', className)}>
      <div className="space-y-4">
        {parseMarkdown(content)}
      </div>
    </div>
  )
}





