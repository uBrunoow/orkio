# ADR 0001 — Execução local não é sandbox

Status: aceito (23/11/2026)

## Contexto

O Orkio roda o CLI `claude` do usuário, na conta dele, num worktree por tarefa. Revisões externas
(comparando com Compozy, Hermes Agent e Orca) pediram que isso fique explícito: as camadas do Orkio
reduzem o que o agente faz, mas não isolam o processo do sistema operacional.

## Decisão

- O processo do Claude Code roda com o usuário do sistema, sem container nem VM. **Não é uma
  sandbox.** Tudo o que o usuário pode ler, um comando aprovado também pode.
- O que o Orkio garante, e testa:
  - escrita fora do worktree bloqueada (`--settings` + `policy.ts`, sem perguntar);
  - push, `gh pr|api|release` bloqueados fora do modo entrega; no modo entrega, só a branch da
    tarefa, sem força nem remoção (`delivery-policy.ts`);
  - shell perguntado (uma vez / sempre neste projeto / negar), com aliases do git e do gh
    expandidos antes da decisão;
  - ambiente sem chaves (`sanitizeEnv`), logs normalizados e redigidos, nenhum token do Orkio no
    processo do Claude.
- Perfis de agente (`.orkio/agents/*.md`) **não são fronteira de segurança**: só restringem
  (entrega, comandos) e passam pelas mesmas regras.
- Isolamento real (container/VM) só entra se o produto aceitar o custo; até lá, a documentação e a
  UI não prometem isolamento.

## Consequências

- Comandos aprovados com "sempre neste projeto" valem para o projeto inteiro: revise a lista.
- A política depende do parsing de `git`/`gh`; versões novas das CLIs podem trazer opções que ela
  não conhece. Opção desconhecida em comando sensível deve ser tratada como bloqueio.
- O diagnóstico (Configurações > Sobre) mostra as versões de `git`, `gh` e `claude` em uso.
