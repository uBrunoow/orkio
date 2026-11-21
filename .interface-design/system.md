# Orkio — system.md (interface-design)

> Criado na Fase 1 da 6E, à mão (a skill interface-design não estava instalada). Coerente com
> `docs/ui-reorg/orkio-design.SKILL.draft.md`. Regras do CLAUDE.md vencem.

## Intenção

Cabine de comando para desenvolvimento com agentes. Quem usa é um dev olhando várias tarefas e
execuções ao mesmo tempo. Prioridade de leitura em toda tela: **esperando você → rodando agora →
estado das coisas → configuração**.

## Hierarquia

1. Título da página (h1) diz onde a pessoa está; migalhas dizem de onde veio. Nunca dois h1.
2. Faixa "Esperando você" acima de tudo quando houver.
3. Conteúdo de trabalho (quadro, log, lista) ocupa a altura útil.
4. Configuração e ações raras num menu "Mais".

## Superfícies

- Nível 0: janela (`background-body`). Nível 1: colunas, cards, painéis (`background-surface`).
  Nível 2: campos, código, popovers (`background-muted`).
- Separação por borda (`--color-border`), nunca sombra. No máximo 2 níveis aninhados.

## Densidade

- App de trabalho: linhas de lista de 1 altura de controle; log com uma linha por evento.
- Cards do quadro: ID (mono) + título (2 linhas no máximo) + sinais em uma linha.
- Painel lateral ~400 px com rolagem própria; tela cheia para o que não cabe.

## Espaçamento

- Escala do tema (`--spacing-*`); padding de página = `contentPadding` do `AppShell`.
- Entre seções: um passo acima do espaçamento interno da seção. Rótulo e campo: o menor passo.
- Mudanças de densidade só no tema, nunca por tela.

## Navegação

- Menu: Visão geral, Execuções · Projeto atual (Quadro, Etapas e automações, Fluxos, Contexto do
  Claude) · Projetos, Integrações, Configurações.
- Command Palette (Ctrl/Cmd+K) e atalhos Ctrl/Cmd+1…5.

## Componentes do sistema

`PageHeader`, `PageState`, `TaskRef`, `SignalChips`, `WaitingItem`, `StatusToken`, `RunLog`,
`SaveBar` (ver docs/ui-reorg.md §4.5).
