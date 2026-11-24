import { describe, expect, it } from 'vitest'
import { canReconnect, isPermanentNotionError, notionErrorLabel } from './notion-errors'

describe('política de erros do Notion', () => {
  it('conexão perdida/expirada: reconectar sempre, qualquer método e chamada', () => {
    for (const code of ['unauthorized', 'invalid_grant', 'not_connected']) {
      for (const method of ['oauth', 'token', null] as const) {
        expect(canReconnect(code, method, 'read')).toBe(true)
        expect(canReconnect(code, method, 'write')).toBe(true)
      }
    }
  })

  it('404 em OAuth: reconectar (leitura e escrita); com token não', () => {
    expect(canReconnect('not_found', 'oauth', 'read')).toBe(true)
    expect(canReconnect('not_found', 'oauth', 'write')).toBe(true)
    expect(canReconnect('not_found', 'token', 'read')).toBe(false)
  })

  it('403 em OAuth: reconectar na leitura; na escrita não (falta Update content)', () => {
    // Antes: o quadro não oferecia na leitura e os bancos ofereciam; a fila nunca.
    expect(canReconnect('forbidden', 'oauth', 'read')).toBe(true)
    expect(canReconnect('forbidden', 'oauth', 'write')).toBe(false)
    expect(canReconnect('forbidden', 'token', 'read')).toBe(false)
  })

  it('recusa definitiva tem rótulo; transitório não é definitivo', () => {
    for (const code of ['bad_request', 'forbidden', 'not_found']) {
      expect(isPermanentNotionError(code)).toBe(true)
      expect(notionErrorLabel(code)).toBeTruthy()
    }
    for (const code of ['network', 'timeout', 'server', 'rate_limited', 'unauthorized']) {
      expect(isPermanentNotionError(code)).toBe(false)
    }
  })
})
