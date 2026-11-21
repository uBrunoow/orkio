# Changelog

Mudanças do Orkio por versão. Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
versões em [SemVer](https://semver.org/lang/pt-BR/). Escreva em "Não lançado" a cada mudança
visível; o `pnpm release` move a seção para a versão nova e as notas do release saem daqui.

## [Não lançado]

### Adicionado

- Instaladores para macOS (Apple Silicon e Intel) e Windows, publicados por CI a cada versão.

## [0.1.0] - 2026-11-20

### Adicionado

- Conexões com Notion (OAuth ou token) e GitHub (Device Flow ou token).
- Projetos locais ligados ao GitHub, quadro por projeto sincronizado com o Notion e automações
  pelos eventos do git/GitHub.
- Claude Code por tarefa (worktree isolado, permissões pelo Orkio), fluxos de tarefa, integração
  com o alva-flow e entrega (push da branch da tarefa, review, CI).
