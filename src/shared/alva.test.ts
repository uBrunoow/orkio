import { describe, expect, it } from 'vitest'
import { BACKLOG_DOC_LIMIT, backlogTaskBody } from './alva'

const FILE = `---
id: TASK-3
title: 'Exportar CSV'
status: Architected
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Exportar os pedidos em CSV.



## Perguntas em aberto
- [ ] Qual separador?
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Gera o arquivo
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Criar o serviço
<!-- SECTION:PLAN:END -->
`

describe('backlogTaskBody', () => {
  it('tira o frontmatter e os marcadores e junta linhas em branco', () => {
    const { body, truncated } = backlogTaskBody(FILE)
    expect(truncated).toBe(false)
    expect(body.startsWith('## Description')).toBe(true)
    expect(body).not.toContain('id: TASK-3')
    expect(body).not.toContain('<!--')
    expect(body).not.toMatch(/\n{3,}/)
    expect(body).toContain('- [ ] #1 Gera o arquivo')
    expect(body).toContain('## Implementation Plan')
    expect(body).toContain('1. Criar o serviço')
  })

  it('aceita CRLF e arquivo sem frontmatter', () => {
    expect(backlogTaskBody('---\r\nid: T\r\n---\r\n\r\nTexto\r\n\r\n\r\n\r\nFim').body).toBe(
      'Texto\n\nFim'
    )
    expect(backlogTaskBody('# Só texto').body).toBe('# Só texto')
  })

  it('corta no limite, no fim de uma linha, e avisa', () => {
    const line = 'x'.repeat(99)
    const long = Array.from({ length: 1000 }, () => line).join('\n')
    const { body, truncated } = backlogTaskBody(long)
    expect(truncated).toBe(true)
    expect(body.length).toBeLessThanOrEqual(BACKLOG_DOC_LIMIT)
    expect(body.endsWith(line)).toBe(true)
  })
})
