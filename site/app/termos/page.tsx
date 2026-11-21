import type { Metadata } from 'next'
import { Contact, LegalPage } from '@/components/LegalPage'
import { getDictionary } from '@/i18n'

export const metadata: Metadata = {
  title: 'Termos de uso',
  description: 'Termos de uso do app Orkio e do site.'
}

export default function Termos() {
  const t = getDictionary()
  return (
    <LegalPage t={t} title="Termos de uso" updated="21/11/2026">
      <p>
        Ao baixar ou usar o Orkio (o app de desktop) e este site, você concorda com estes termos.
      </p>

      <h2>O que é o Orkio</h2>
      <p>
        Um app que organiza tarefas do Notion num quadro, roda o Claude Code nelas em ambientes
        isolados e acompanha branches e PRs no GitHub. Ele age com as <strong>suas</strong> contas e
        permissões nesses serviços.
      </p>

      <h2>Sua responsabilidade</h2>
      <ul>
        <li>
          Você é responsável pelas contas que conecta, pelo que autoriza o agente a fazer e pelo
          código que aprova, publica e mergeia. O Orkio pede aprovação antes de publicar e bloqueia
          ações perigosas, mas revise o que o agente produz.
        </li>
        <li>
          Use o Orkio de acordo com os termos do Notion, do GitHub e da Anthropic (Claude Code).
        </li>
        <li>
          Não use o site para tentar acessar dados de outras pessoas ou sobrecarregar o serviço.
        </li>
      </ul>

      <h2>Sem garantias</h2>
      <p>
        O Orkio é oferecido &ldquo;como está&rdquo;, sem garantia de funcionamento contínuo ou livre
        de erros. Faça backup do que for importante. Na medida permitida pela lei, não respondemos
        por perdas causadas pelo uso do app, por falhas de serviços de terceiros ou por código
        gerado por agentes.
      </p>

      <h2>Dados</h2>
      <p>
        O tratamento de dados está descrito na <a href="/privacidade">política de privacidade</a>:
        tokens só no seu computador, cifrados; o site só repassa o login do Notion e não guarda
        nada.
      </p>

      <h2>Mudanças</h2>
      <p>
        Podemos atualizar estes termos; a data no topo mostra a última mudança. Mudanças importantes
        serão avisadas nas notas de versão do app.
      </p>

      <h2>Contato</h2>
      <p>
        <Contact t={t} />
      </p>
    </LegalPage>
  )
}
