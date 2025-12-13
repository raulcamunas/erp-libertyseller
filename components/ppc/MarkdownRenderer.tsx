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
        const boldText = trimmed.replace(/\*\*(.*?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
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

