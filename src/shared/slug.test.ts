import { describe, expect, it } from 'vitest'
import { extractTaskNumbers } from './task-id-match'
import {
  isBranchKind,
  normalizePageId,
  notionPageIdsIn,
  slugify,
  taskBranchName,
  uniqueBranchName
} from './slug'

describe('taskBranchName', () => {
  it('feat/ por padrão; com ID do Notion o ID entra no nome (e casa nos sinais)', () => {
    expect(taskBranchName('ORK-142', 'Listar tarefas do Notion')).toBe(
      'feat/ORK-142-listar-tarefas-do-notion'
    )
    expect(extractTaskNumbers('feat/ORK-142-listar-tarefas-do-notion', 'ORK')).toEqual([142])
  })

  it('sem ID: só o tipo e o título; o tipo escolhido à mão vale', () => {
    expect(taskBranchName(null, 'Corrigir login')).toBe('feat/corrigir-login')
    expect(taskBranchName(null, 'Corrigir login', 'hotfix')).toBe('hotfix/corrigir-login')
    expect(slugify('')).toBe('tarefa')
  })

  it('isBranchKind aceita só feat, fix e hotfix', () => {
    expect(isBranchKind('fix')).toBe(true)
    expect(isBranchKind('chore')).toBe(false)
    expect(isBranchKind(undefined)).toBe(false)
  })

  it('uniqueBranchName acrescenta -2, -3… se o nome já existe', () => {
    expect(uniqueBranchName('feat/x', new Set())).toBe('feat/x')
    expect(uniqueBranchName('feat/x', new Set(['feat/x', 'feat/x-2']))).toBe('feat/x-3')
  })
})

describe('notionPageIdsIn', () => {
  const id = '1a2b3c4d5e6f40718293a4b5c6d7e8f9'
  it('acha o id da página em links do Notion (com ou sem hífens, com query)', () => {
    expect(
      notionPageIdsIn(`Tarefa: https://www.notion.so/acme/Listar-pedidos-${id}?pvs=4 e mais texto`)
    ).toEqual([id])
    expect(
      notionPageIdsIn('(https://acme.notion.site/1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9)')
    ).toEqual([id])
    expect(notionPageIdsIn(`Notion: https://app.notion.com/p/${id}?pvs=204`)).toEqual([id])
  })

  it('ignora textos sem link do Notion e não repete', () => {
    expect(notionPageIdsIn(null)).toEqual([])
    expect(notionPageIdsIn(`id solto ${id} sem link`)).toEqual([])
    expect(notionPageIdsIn(`https://notion.so/${id} https://www.notion.so/x-${id}`)).toHaveLength(1)
    expect(normalizePageId('1A2B3C4D-5E6F-4071-8293-A4B5C6D7E8F9')).toBe(id)
  })
})
