# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(App de desktop em Electron; a interface é web: React + Astryx no renderer.)

## Users

Devs e tech leads de times pequenos que planejam no Notion, versionam no GitHub e usam o Claude
Code com a própria assinatura. Usam o Orkio o dia todo, ao lado do editor, para delegar tarefas a
agentes, acompanhar o que está rodando e aprovar o que importa (spec, plano, diff, push, PR) sem
perder o controle.

## Product Purpose

Orquestrar Notion, GitHub e Claude Code: a tarefa nasce no Notion, anda num quadro com colunas e
automações, é feita pelo Claude Code num worktree isolado e vira PR, com a pessoa aprovando nos
gates. Sucesso = a pessoa abre o app e sabe na hora o que espera por ela e o que está rodando, e
uma tarefa vai do Notion à PR sem copiar contexto entre ferramentas.

## Positioning

Usa o CLI `claude` e o login da própria pessoa (sem chave da Anthropic), roda cada tarefa num
worktree isolado com permissões decididas pelo Orkio, e nunca publica fora da branch da tarefa:
push só da branch, nunca com força, nunca na main. O Notion continua a fonte da verdade.

## Operating Context

- Janela de desktop ao lado do editor (Cursor/VS Code) e do terminal; uso longo, olhadas rápidas.
- Vocabulário: tarefa (ORK-142), quadro, etapa/coluna, automação, fluxo, gate, agente,
  orquestrador, worktree, branch, PR, CI, spec, plano (Backlog.md, plugin alva-flow).
- Fases de uma tarefa pelo alva-flow: Spec → Plano → Implementar → Revisão → PR.

## Capabilities and Constraints

- Conectores: Notion (OAuth/token), GitHub (Device Flow/token, obrigatório para adicionar
  projeto), Claude Code (CLI do usuário).
- O Orkio não cria tarefas (elas vêm do Notion); "Buscar tarefa" no lugar de "Nova tarefa".
- Segredos só no processo main; CSP estrita (nada de `<style>` em runtime); UI com Astryx e
  tokens do tema Orkio; textos em pt-BR. Detalhes em `CLAUDE.md`.
- Ainda não existem: login no app, webhooks, integrações além de Notion/GitHub/Claude Code.

## Brand Commitments

- Nome Orkio, logo e wordmark de `brand/` (ver `brand/BRAND.md`); tema Orkio (preto + laranja).
- Referências visuais tornadas obrigatórias pelo usuário: o mockup aprovado
  `docs/superpowers/specs/2026-11-23-orkio-ui-mockup.html` e o protótipo "Alva Tasks"
  (`~/Downloads/Alva Tasks – Alva Tasks.html`, artefato claude.ai `L9sJZw5MeWVwsThzteVJ9e`),
  puxando mais do Alva Tasks além do mockup: fases no cabeçalho, conversa central, documento/plano
  à direita, linhas divisórias, densidade "tech".
- Tom: pt-BR direto, frases curtas, verbos de ação; técnico quando ajuda.

## Evidence on Hand

Sem clientes, depoimentos ou números de produtividade: não inventar. Integrações que não existem
não aparecem.

## Product Principles

1. O que espera a pessoa vem primeiro, em qualquer tela.
2. Controle explícito: nada sai da máquina (push, PR, escrita no Notion) sem regra ou aprovação.
3. A tarefa é o centro: conversa com o agente, fases e o documento da fase no mesmo lugar.
4. Menos telas: configurar é um caminho só; o dia a dia é Quadro, Tarefa e Agentes.
