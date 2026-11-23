/**
 * Textos do site em pt-BR. O inglês entra depois com o mesmo formato (`Dictionary`).
 * Afirme só o que o Orkio faz hoje (ver site/PRODUCT.md).
 */
export const ptBR = {
  locale: 'pt-BR',
  meta: {
    title: 'Orkio — do contexto ao commit',
    description:
      'App de desktop que orquestra Notion, GitHub e Claude Code: a tarefa sai do Notion, anda no quadro, vira código num ambiente isolado e chega à PR com a sua aprovação.'
  },
  skip: 'Pular para o conteúdo',
  nav: {
    label: 'Navegação principal',
    how: 'Como funciona',
    automations: 'Automações',
    safety: 'Segurança',
    download: 'Download',
    faq: 'Perguntas'
  },
  hero: {
    slogan: 'Do contexto ao commit',
    title: 'Suas tarefas do Notion viram PRs revisadas. Com você no controle.',
    lead: 'O Orkio orquestra Notion, GitHub e Claude Code num app de desktop: monta o quadro, roda o agente num ambiente isolado por tarefa e move cada card conforme a PR avança.',
    secondary: 'Ver como funciona',
    note: 'macOS e Windows · usa o seu login do Claude Code'
  },
  how: {
    title: 'Como funciona',
    lead: 'Um caminho só, do pedido ao merge. Cada etapa conversa com a ferramenta que você já usa.',
    steps: [
      {
        name: 'Notion',
        text: 'Você escolhe os bancos de Projetos e Tarefas. O Orkio lê as tarefas com ID (ORK-142) e o status de cada uma.'
      },
      {
        name: 'Quadro',
        text: 'Um kanban por projeto, com colunas ligadas ao status do Notion. Mover o card atualiza o Notion.'
      },
      {
        name: 'Claude Code',
        text: 'Cada tarefa roda num worktree próprio, com o briefing da página. Você vê o log ao vivo e aprova o que o agente pede.'
      },
      {
        name: 'PR',
        text: 'Commit, push da branch da tarefa e PR aberta, cada passo depois da sua aprovação. Revisão e CI aparecem no card.'
      },
      {
        name: 'Finalizada',
        text: 'Mergeou? A tarefa vai para Finalizada sozinha, e o Notion acompanha.'
      }
    ]
  },
  board: {
    caption: 'O quadro do projeto, com a tarefa andando pelas colunas.',
    columns: ['Prioridades', 'Em andamento', 'Revisando', 'Finalizada'],
    agent: 'Claude Code rodando',
    review: 'Revisão pedida',
    ci: 'CI passou'
  },
  automations: {
    title: 'Automações por coluna',
    lead: 'O GitHub diz o que aconteceu; regras simples dizem para onde a tarefa vai. Primeira observação é só linha de base: nada se move pelo histórico antigo.',
    rules: [
      { when: 'Branch ORK-142 criada', then: 'Em andamento' },
      { when: 'PR aberta', then: 'Revisando' },
      { when: 'Alterações pedidas na revisão', then: 'Revisado' },
      { when: 'Novo pedido de review', then: 'Revisando' },
      { when: 'PR mergeada', then: 'Finalizada' }
    ],
    flowsTitle: 'Fluxos de tarefa',
    flows:
      'Ligue uma sequência de passos a uma coluna: comandos do Claude Code, gates de aprovação, saltos condicionais. Entrou em Em andamento? Implementa, revisa, mostra o diff e espera você.'
  },
  safety: {
    title: 'Nada vai para a main sem você',
    lead: 'Delegar ao agente não é entregar as chaves. O Orkio decide o que o Claude Code pode fazer e para nos pontos que importam.',
    points: [
      {
        title: 'Push só da branch da tarefa',
        text: 'Sem força, sem apagar branch, nunca na main, develop ou production. Merge e release continuam com você.'
      },
      {
        title: 'Gate antes de publicar',
        text: 'Antes do push você vê os commits, o diff e o destino. Antes de pedir review, quem vai revisar.'
      },
      {
        title: 'Permissões pelo Orkio',
        text: 'Ler e editar só dentro do ambiente da tarefa. Comandos de shell pedem sua aprovação; o que é perigoso é bloqueado e fica no histórico.'
      },
      {
        title: 'Seus tokens ficam com você',
        text: 'Guardados só no seu computador, cifrados pelo sistema. O Orkio usa o seu login do Claude Code e não pede chave da Anthropic.'
      }
    ],
    gate: {
      title: 'Enviar a branch para o GitHub?',
      destination: 'Destino',
      commits: 'Commits',
      approve: 'Fazer push',
      reject: 'Recusar'
    }
  },
  integrations: {
    title: 'Integrações',
    items: [
      {
        name: 'Notion',
        text: 'Login com OAuth (ou token). Bancos de Projetos e Tarefas, status e briefing da página.'
      },
      {
        name: 'GitHub',
        text: 'Login pelo Device Flow (ou token). Branches, PRs, revisões e CI de cada tarefa.'
      },
      {
        name: 'Claude Code',
        text: 'O CLI claude com a sua assinatura. Comandos, skills e plugins que você já instalou.'
      }
    ]
  },
  download: {
    title: 'Baixe o Orkio',
    lead: 'Grátis para usar. Você só precisa das suas contas do Notion, do GitHub e do Claude Code.',
    suggested: 'Baixar para',
    version: 'Versão',
    others: 'Outros sistemas',
    all: 'Ver todos os arquivos',
    soon: 'O primeiro release público sai em breve.',
    unavailable: 'Não conseguimos ler o último release agora.',
    linux: 'Este release não tem versão para Linux.',
    linuxNote:
      'No Ubuntu ou Debian, o .deb instala direto. O AppImage roda em qualquer distro e se atualiza sozinho. Precisa de um chaveiro do sistema (GNOME Keyring ou KWallet) para guardar os tokens.',
    macNote: 'Não sabe qual Mac? Menu Apple → Sobre este Mac: “Apple M…” é Apple Silicon.',
    labels: {
      'mac-arm64': 'macOS (Apple Silicon)',
      'mac-x64': 'macOS (Intel)',
      windows: 'Windows',
      'linux-appimage': 'Linux (AppImage)',
      'linux-deb': 'Linux (.deb)'
    }
  },
  faq: {
    title: 'Perguntas frequentes',
    items: [
      {
        q: 'O Orkio guarda meus tokens em algum servidor?',
        a: 'Não. Os tokens do Notion e do GitHub ficam só no seu computador, cifrados pelo sistema (Keychain no macOS, DPAPI no Windows, chaveiro do sistema no Linux). O site do Orkio só repassa a troca do login OAuth do Notion, porque o Notion exige um segredo que um app de desktop não pode guardar, e não grava nada.'
      },
      {
        q: 'Preciso de chave de API da Anthropic?',
        a: 'Não. O Orkio usa o CLI do Claude Code instalado no seu computador, com o seu login e a sua assinatura.'
      },
      {
        q: 'O agente pode fazer push na main?',
        a: 'Não. Push só da branch da tarefa, sem força, e com a sua aprovação antes (por padrão). Merge, release e push em outras branches são bloqueados.'
      },
      {
        q: 'O Orkio escreve no meu Notion?',
        a: 'Só o status da tarefa quando o card muda de coluna (e, se você pedir, publica um documento como subpágina). O conteúdo das páginas não é gravado no seu disco.'
      },
      {
        q: 'Funciona com GitHub Enterprise ou GitLab?',
        a: 'Hoje, só github.com. Repositórios do GitHub Enterprise aparecem com recursos limitados.'
      },
      {
        q: 'E no Linux?',
        a: 'Sim, x64: AppImage (qualquer distro, com atualização automática) e .deb (Ubuntu/Debian). Os tokens ficam no chaveiro do sistema (GNOME Keyring ou KWallet); sem ele, o Orkio não salva a conexão.'
      }
    ]
  },
  footer: {
    tagline: 'Do contexto ao commit.',
    privacy: 'Privacidade',
    terms: 'Termos',
    rights: 'Orkio'
  },
  legal: {
    updated: 'Atualizado em',
    back: 'Voltar ao início',
    contactMissing: 'contato a definir'
  }
} as const

export type Dictionary = typeof ptBR
