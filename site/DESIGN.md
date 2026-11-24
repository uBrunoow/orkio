# Orkio — design do site

Derivado de `brand/BRAND.md` e `brand/tokens.css`. A marca manda; referências externas (landings
de ferramentas de dev) só inspiram ritmo e composição.

## Direção

**Control plane.** Preto profundo com a grade técnica no hero (sinais laranja correndo pelas linhas), uma luz laranja difusa
de onde sai a janela do app em perspectiva, e títulos numa grotesca técnica e justa. O laranja é
sinal: agentes (os sinais que correm na grade), ação principal, o nó do Claude Code. O site mostra o
produto (quadro, sessão, gate, diff) em vez de ilustrar com metáforas. Referências de técnica, não
de código: Compozy (campo, luz, janela que assenta), Orca e OpenBot.

## Cor (tokens, nada de hex solto fora de `app/tokens.css`)

| Token                              | Valor     | Uso                                       |
| ---------------------------------- | --------- | ----------------------------------------- |
| `--bg`                             | `#0A0A0B` | fundo                                     |
| `--surface`                        | `#141416` | cartões, mockups                          |
| `--raised`                         | `#1E1E21` | elementos sobre cartões                   |
| `--border`                         | `#2C2C30` | linhas, grade                             |
| `--text`                           | `#F2F2F0` | texto principal                           |
| `--muted`                          | `#8F8F94` | texto de apoio (contraste 6,3:1 no fundo) |
| `--accent`                         | `#FF5B1F` | CTA principal, símbolo, estados de agente |
| `--on-accent`                      | `#0A0A0B` | texto sobre laranja (sempre preto)        |
| `--success`/`--warning`/`--danger` |           | chips de status nos mockups               |

Laranja com parcimônia: um CTA primário por seção, o símbolo, o ponto "hub" e chips de agente.

## Tipografia (fontes locais via `next/font/local`)

- **Geist** (variável, OFL, `app/fonts/geist-variable.woff2`) nos títulos: peso ~560,
  `letter-spacing` de -0,02em a -0,045em conforme o tamanho, `line-height` ~1.
- **Jost** só no wordmark do logo e no slogan.
- **Inter** no texto.
- **JetBrains Mono** só para dado: IDs (`ORK-142`), comandos, branches, caminhos, diff.
- Escala fluida com `clamp()`; parágrafos até ~60 caracteres; nada abaixo de 12px.

## Forma e composição

- Raio `8px` (controles), `12px` (cartões e tabelas), `14px` (janelas). Bordas de 1px em
  `--border`; divisórias internas em `--border-soft`. Sem sombra larga em cartão: a profundidade
  vem da luz do palco; janelas têm só um fio de luz no topo (`inset 0 1px 0`).
- **Hero:** centralizado. Grade com sinais (`components/HeroField.tsx`: grade em CSS, sinais em canvas 2D; as partículas caindo foram descartadas) no fundo; título,
  texto, "Baixar para <sistema>" + "Ver no GitHub" e a nota com a versão. Abaixo, a **luz do palco**
  (brilho difuso, sem arco nem borda: o arco foi descartado por incomodar) e a **janela do app** (`AppPreview`): barra de título de
  desktop, caminho + fases, lateral só com grupos não vazios e quatro momentos em abas (Quadro,
  Sessão, Push com o gate por cima da sessão escurecida, Revisão). Ela entra inclinada
  (`rotateX`) e assenta com a rolagem (`animation-timeline: view()`).
- **Como funciona:** pipeline numa caixa só, cinco nós em colunas alinhadas por `subgrid` (nome,
  dado em mono, texto curto, "via" tracejado com a ferramenta), o chip `ORK-142` viajando; regras
  numa tabela com cabeçalho e o tom do status no destino.
- **Recursos:** texto e recorte alternados; recortes (`components/Crops.tsx`) com a mesma moldura
  da janela (barra com breadcrumb), conteúdo encostado, divisórias em vez de caixas aninhadas; o de
  revisão mostra um diff de verdade.
- **Segurança:** faixa em `--surface` (a única que quebra o preto), terminal com os comandos
  bloqueados riscados e a lista de garantias com divisórias.
- **Download:** um cartão por sistema; laranja só no arquivo deste computador.
- **Fechamento:** a mesma luz difusa, por baixo, com o símbolo e o botão.
- Sem rótulos acima dos títulos, sem numeração decorativa, sem "→" pendurado em link.

## Movimento

O hero é o momento orquestrado: título e texto entram uma vez (sobem e perdem o desfoque), a grade
com os sinais laranja correndo pelas linhas e acendendo os cruzamentos, a luz do palco respira (9 s) e a
janela assenta com a rolagem; dentro dela, o card anda de coluna, a conversa entra em sequência e o
gate confirma. Em "Como funciona", o chip `ORK-142` viaja pelo pipeline. Canvas para fora da tela e
com a aba escondida; tudo desliga com `prefers-reduced-motion: reduce` (o chip some, o campo fica
parado). Sem granulado: a marca é preto piano, liso.

## Acessibilidade

- Contraste AA no mínimo (texto principal ~17:1; apoio 6,3:1; laranja sobre preto 6,5:1).
- Foco visível em laranja (`outline` 2px + offset), "Pular para o conteúdo" no topo.
- Landmarks (`header`, `nav`, `main`, `footer`), um `h1`, hierarquia sem saltos.
- Mockups decorativos com `aria-hidden` e uma descrição em texto ao lado.
- `lang="pt-BR"`; nada depende só de cor.

## Privacidade

Sem cookies, sem rastreadores, sem fontes ou scripts de terceiros. Vercel Analytics só se ligado
depois, sem cookies e com aviso na /privacidade.
