---
name: orkio-design
description: Linguagem de design do app Orkio (Electron + Astryx, tema Orkio). Use ao criar ou mudar qualquer tela, componente ou texto de UI do app em src/renderer. Não vale para o site (site/).
---

# orkio-design

Gerada na Fase 1 da 6E (aprovada; sem a skill hue, que não estava instalada), a partir de
`brand/BRAND.md`, `themes/orkio/orkio.settings.json`, do CLAUDE.md e dos prints das telas atuais.
O CLAUDE.md vence esta skill em qualquer conflito.

## Intenção

Ferramenta profissional de desenvolvedor, não gerenciador de tarefas genérico. Sensação de
**cabine de comando silenciosa**: fundo preto piano, informação densa e legível, e o laranja só
onde um agente está trabalhando ou onde a pessoa precisa agir. A pergunta de toda tela é
"o que está esperando por mim e o que está rodando?".

## Tokens (só pelo tema; nunca hex/px no código)

| Papel                            | Token                                                | Valor de referência                               |
| -------------------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| Fundo da janela                  | `--color-background-body`                            | preto piano                                       |
| Superfície (cards, colunas)      | `--color-background-surface` / `-card`               | 1 nível acima                                     |
| Elevado (popover, campo, código) | `--color-background-muted`                           | 2 níveis acima                                    |
| Borda                            | `--color-border`                                     | única forma de separação; sem sombras             |
| Texto                            | `--color-text-primary` / `--color-text-secondary`    | off-white / cinza                                 |
| Marca/ação                       | accent (laranja), `--color-accent-muted` para fundos | texto sobre laranja = `--color-on-accent` (preto) |
| Estados                          | success (verde), warning (amarelo), danger (rosa)    | o rosa nunca é confundido com o laranja           |

Espaçamento e raios: `--spacing-*` e `--radius-*` do tema. Densidade muda no tema
(`editor set orkio spacing …`), nunca página a página.

## Tipografia

- **Inter** em toda a UI. **Jost** só no logo e em títulos de destaque (`.orkio-display`,
  `.orkio-slogan`). **JetBrains Mono** para IDs (ORK-142), branches, comandos, caminhos, tokens.
- Escala curta: título de página (`Heading level={1}`), seção (`level={2}`), grupo (`level={3}`),
  corpo, secundário. No máximo 3 tamanhos por tela além do título.
- Medida de leitura: textos de ajuda com no máximo ~75 caracteres por linha.
- Números que se comparam (contagens, custo, duração) com algarismos tabulares.
- Truncar com reticências + tooltip: títulos de tarefa em cards e listas, branches longas (corte
  no meio). Nunca truncar o gatilho de uma automação nem o comando de uma permissão.
- Plural de verdade ("1 mudança", "2 mudanças"), nunca "(s)". Decimal com vírgula (US$ 0,01).
- Datas: relativas na atividade recente ("há 3 min") com a absoluta no tooltip (`Timestamp`).

## Cor com parcimônia

- Laranja: `Button variant="primary"` (uma por área), o símbolo, e estados de agente
  ("Rodando"). Nada mais.
- Estado = ponto colorido + texto (`StatusToken`), nunca bloco colorido; prioridade é texto cinza. Metadados numa linha cinza separada por `·` (`PageHeader meta`). Status sempre pelo mapa único: sucesso = concluído/OK/aprovado; aviso =
  esperando você / falta configurar / não verificado; erro = falhou / CI vermelho / alterações
  pedidas; laranja = agente rodando; neutro = etapas e prioridade.
- Ação destrutiva é secundária até a confirmação inline; o vermelho aparece na confirmação.

## Componentes e padrões

- Layout só com `VStack`/`HStack`/`Grid`/`Card`; dados densos em `List`/`Item` ou `Table`;
  `Badge` só para contagem; status em `Token`; mensagens em `components/Alert.tsx`.
- Toda página: `PageHeader` (migalhas + título + no máximo 1 primária + menu "Mais") e
  `PageState` para vazio/carregando/erro.
- "Esperando você" (permissão, pergunta, gate, push aguardando) usa `WaitingItem` e fica **no
  topo** de onde aparecer: Visão geral, tarefa, painel.
- Rótulos visíveis curtos; o contexto para leitor de tela ("… do passo 2") vai no nome acessível,
  não no texto visível.
- Painéis têm rolagem própria; a página não rola junto.
- Formulários longos: lista à esquerda + editor à direita, barra de salvar fixa quando há
  rascunho.

## Moldura

Barra superior fina (logo, projeto atual, buscar, sino com contador) + coluna só de ícones à
esquerda (rótulo no tooltip e no nome acessível) + conteúdo num painel com borda e raio. Contador
na coluna não existe (a Astryx esconde `endContent` recolhido): use o ponto no ícone e o número no
sino.

## Quadro

Card de três linhas (ID + agente + estado + menu / título / metadados cinza). Colunas recolhíveis
com contador. Tarefa abre numa folha sobre as colunas (abaixo do cabeçalho), nunca num modal que
cubra a janela; "Abrir tarefa" leva à página inteira. Kanban/Lista por `SegmentedControl`.

## Tarefa

Histórico em forma de conversa (`TaskTimeline`: autor, frase, horário; sem balões). Decisão
pendente sempre no topo ("Esperando você"); passos do fluxo num resumo recolhível; rodapé
"Trabalhando há…" com `Timer` enquanto algo roda. Sem campo de chat livre.

## Regras e fluxos

Detalhe em frase antes do formulário (`SentenceDetail`): frase como título, "Começa", "Faz",
execuções em tabela e coluna de detalhes; o editor fica atrás de "Editar".

## Integrações

Catálogo no topo (grade de duas colunas: logo, nome, categoria, estado, ação) e os cards de
configuração abaixo; a ação leva ao card. Nunca listar integração que o app não tem.

## Agentes

Avatar só pelo `AgentAvatar` (forma geométrica do id, cores do tema; nunca iniciais nem foto).
Lista de agentes em grade de cards com alternância Cards/Linhas, filtros com contagem e busca `/`.

## Movimento e CSP

Só o movimento dos próprios componentes da Astryx; respeitar `prefers-reduced-motion`. Nada que
injete `<style>` (ver "Astryx e CSP" no CLAUDE.md). Diálogos/camadas novos: confirmar no E2E.

## Texto

pt-BR, curto e acionável, verbo no início dos botões ("Rodar fluxo", "Permitir uma vez").
Mensagem de erro diz o que aconteceu e o que fazer; nunca a exceção crua.

## Checklist antes de entregar uma tela

1. Sem `<div>`/`<span>`, hex ou px; `astryx doctor --built src/renderer` sem falhas.
2. Vazio, carregando e erro com `PageState`.
3. Uma primária por área; destrutivas secundárias.
4. Funciona em 1000×700 sem barra quebrar em 3 linhas.
5. Print antes/depois; E2E por papel/nome acessível; zero violação de CSP.
