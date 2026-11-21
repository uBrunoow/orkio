import type { Metadata } from 'next'
import { Contact, LegalPage } from '@/components/LegalPage'
import { getDictionary } from '@/i18n'

export const metadata: Metadata = {
  title: 'Privacidade',
  description:
    'Como o Orkio trata seus dados: tokens só no seu computador, cifrados; o site não guarda nada.'
}

export default function Privacidade() {
  const t = getDictionary()
  return (
    <LegalPage t={t} title="Política de privacidade" updated="21/11/2026">
      <p>
        O Orkio é um app de desktop. Ele roda no seu computador e conversa direto com o Notion, o
        GitHub e o Claude Code com as <strong>suas</strong> contas. Esta página explica o que fica
        onde, em linguagem simples.
      </p>

      <h2>Resumo</h2>
      <ul>
        <li>
          Seus tokens do Notion e do GitHub ficam <strong>só no seu computador</strong>, cifrados
          pelo sistema operacional (Keychain no macOS, DPAPI no Windows). Se a cifragem não estiver
          disponível, o app não salva o token.
        </li>
        <li>
          O <strong>site do Orkio não guarda nada</strong>: ele só repassa a troca do login OAuth do
          Notion e não tem banco de dados, contas nem cookies.
        </li>
        <li>Não vendemos, não compartilhamos e não analisamos seus dados. Não há rastreadores.</li>
      </ul>

      <h2>O que o app guarda no seu computador</h2>
      <ul>
        <li>Tokens de acesso do Notion e do GitHub, cifrados.</li>
        <li>
          Configuração não secreta: projetos (pastas locais e repositórios), bancos do Notion
          escolhidos, colunas e automações do quadro, fluxos de tarefa.
        </li>
        <li>
          Um banco local com o estado do quadro, o histórico das tarefas e os logs das execuções do
          Claude Code, com segredos redigidos. Só ids e estados do Notion; o conteúdo das páginas
          não é gravado em disco.
        </li>
      </ul>
      <p>
        Tudo isso fica na pasta de dados do app. Desinstalar o app e apagar essa pasta remove tudo.
      </p>

      <h2>O que o site faz no login do Notion</h2>
      <p>
        O Notion exige um segredo do aplicativo (client secret) para trocar o código de autorização
        por um token e para renovar o token. Um app de desktop não consegue esconder segredos, então
        essas duas chamadas passam pelo site do Orkio, que guarda o secret em variável de ambiente
        do servidor e repassa a resposta ao seu app.
      </p>
      <ul>
        <li>
          O site <strong>não armazena</strong> códigos, tokens nem respostas, e não registra o
          conteúdo das requisições. A hospedagem (Vercel) registra dados técnicos como data, rota,
          status e endereço IP por um período curto, para operação e segurança.
        </li>
        <li>
          O site só aceita o endereço de retorno do próprio app no seu computador (127.0.0.1) e
          devolve apenas os campos do token que o app usa.
        </li>
      </ul>

      <h2>Serviços de terceiros</h2>
      <p>
        Ao usar o Orkio você também usa o Notion, o GitHub e o Claude Code (Anthropic), cada um com
        a própria política de privacidade. O Orkio acessa só o que você autorizar nesses serviços. O
        Claude Code roda com o seu login e a sua assinatura; o Orkio não pede nem guarda chave da
        Anthropic.
      </p>

      <h2>Site</h2>
      <p>
        Este site não usa cookies, rastreadores nem fontes ou scripts de terceiros. Se um dia
        usarmos medição de audiência, será sem cookies e avisada aqui.
      </p>

      <h2>Contato</h2>
      <p>
        Dúvidas ou pedidos sobre privacidade: <Contact t={t} />.
      </p>
    </LegalPage>
  )
}
