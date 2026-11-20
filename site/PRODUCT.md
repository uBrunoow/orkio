# Orkio — produto (para o site)

## Uma frase

**Do contexto ao commit.** O Orkio é um app de desktop que orquestra Notion, GitHub e Claude Code:
a tarefa nasce no Notion, anda num quadro com colunas e automações, é feita pelo Claude Code num
ambiente isolado e vira PR, sempre com você aprovando o que importa.

## Para quem

- Times pequenos e devs que já planejam no **Notion**, versionam no **GitHub** e usam o
  **Claude Code** com a própria assinatura, e cansaram de copiar contexto entre os três.
- Quem quer delegar trabalho a um agente **sem abrir mão do controle**: nada vai para a main sem a
  pessoa ver.

## O que o Orkio faz (em ordem do fluxo)

1. **Notion → Quadro.** Lê os bancos de Projetos e Tarefas e monta um kanban por projeto, com as
   etapas ligadas ao status do Notion. Mover o card escreve no Notion.
2. **Quadro → Claude Code.** Cada tarefa roda num worktree próprio, com briefing montado da página
   do Notion, permissões decididas pelo Orkio e log ao vivo. Usa o CLI `claude` e o login da pessoa.
3. **Claude Code → PR.** Fluxos de tarefa por coluna (implementar, revisar, commitar, abrir PR) com
   gates de aprovação. Push só da branch da tarefa, nunca com força, nunca na main.
4. **PR → Finalizada.** Sinais do GitHub (branch, PR, revisão, CI) movem a tarefa sozinhos por
   automações declarativas: PR aberta → Revisando; alterações pedidas → Revisado; merge →
   Finalizada.

## Promessas (o que o site pode afirmar)

- **Você aprova o que sai.** Gates antes de commit e push; diff e destino na tela; merge, força e
  outras branches bloqueados.
- **Seus tokens ficam com você.** Guardados só no computador, cifrados pelo sistema (Keychain,
  DPAPI, libsecret). O site só repassa a troca do OAuth do Notion e não guarda nada.
- **Sua assinatura do Claude.** O Orkio usa o CLI `claude` com o seu login; não pede nem guarda
  chave da Anthropic.
- **O Notion continua a fonte da verdade.** Nada do conteúdo das páginas é gravado em disco.

## O que NÃO afirmar

- Que o Orkio "faz tudo sozinho" ou "substitui o dev".
- Integrações que não existem (Jira, Linear, GitLab, Slack…), login no app, webhooks, nuvem.
- Números de produtividade, clientes ou depoimentos.
- Que é open source (até decisão contrária).

## Tom

pt-BR direto, frases curtas, verbos de ação, sem jargão de marketing ("revolucionário",
"potencialize"). Técnico quando ajuda (`ORK-142`, `/alva-flow:pr`, `git push`), sempre legível por
quem não programa todo dia.

## Páginas

`/` (landing), `/privacidade`, `/termos`. As duas últimas vão no cadastro da integração pública do
Notion. Inglês depois (`/en`), com os textos em `i18n/`.
