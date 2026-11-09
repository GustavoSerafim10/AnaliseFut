/**
 * Conferência da leitura: cada print é lido mais de uma vez, e aqui aparece o que todas as
 * leituras confirmaram e o que precisa de um olho humano antes de confiar.
 */
import { descreverAposta, type LinhaOdd, type NomesTimes } from '@pe/engine';
import type { AuditoriaLeitura } from '@pe/parsers';
import type { OddLine } from '@pe/schemas';
import { Kpi, Painel } from './CentroComando';

const n2 = (x: number) => String(x).replace('.', ',');

function Grupo({
  titulo,
  dica,
  itens,
  nomes,
  detalhe,
}: {
  titulo: string;
  dica: string;
  itens: { linha: OddLine; texto?: string }[];
  nomes: NomesTimes;
  detalhe?: boolean;
}) {
  if (!itens.length) return null;
  return (
    <details className="cc-conf-grupo">
      <summary>
        {titulo} <span>{itens.length}</span>
      </summary>
      <p className="cc-nota">{dica}</p>
      <ul>
        {itens.map(({ linha, texto }, i) => (
          <li key={i}>
            <b>{descreverAposta(linha as LinhaOdd, nomes).replace('Ganha se: ', '')}</b>
            {!detalhe && ` @ ${n2(linha.odd)}`}
            {texto && <small> {texto}</small>}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ConferenciaLeitura({
  a,
  naoEntendidas,
  nomes,
}: {
  a: AuditoriaLeitura;
  naoEntendidas: number;
  nomes: NomesTimes;
}) {
  if (!a.total && !a.descartadas.length) return null;
  // entraram na análise sem confirmação: só estas pedem um olhar antes de apostar
  const conferir = a.divergentes.length + a.umaLeitura.length + a.semOutroLado.length;
  const naoEntraram = a.foraDaAnalise.length + a.descartadas.length + naoEntendidas;
  return (
    <Painel
      titulo="Conferência da leitura"
      icone="escudo"
      extra={
        <span className="cc-extra-texto">
          {conferir ? `${conferir} para conferir` : 'tudo confirmado'}
          {naoEntraram > 0 && ` · ${naoEntraram} não entraram`}
        </span>
      }
    >
      {a.leituras < 2 && (
        <p className="cc-nota">
          Estes prints foram lidos uma vez só. Cole de novo para o site ler cada um várias vezes e
          confirmar as odds.
        </p>
      )}
      <div className="cc-kpis">
        <Kpi
          icone="alvo"
          rotulo="Odds lidas"
          valor={a.total}
          sub={a.total ? `${a.foraDaAnalise.length} fora da análise` : undefined}
        />
        <Kpi
          icone="trofeu"
          rotulo="Confirmadas"
          valor={a.confirmadas}
          tom={a.confirmadas ? 'ok' : undefined}
          sub="mesma odd em 2+ leituras"
        />
        <Kpi
          icone="lupa"
          rotulo="Divergentes"
          valor={a.divergentes.length}
          tom={a.divergentes.length ? 'erro' : undefined}
          sub="leituras discordaram"
        />
        <Kpi
          icone="info"
          rotulo="Não entendidas"
          valor={naoEntendidas}
          tom={naoEntendidas ? 'erro' : undefined}
          sub="linhas com números"
        />
      </div>
      <Grupo
        titulo="Leituras discordaram"
        dica="Entrou o valor mais votado. Confira no print."
        nomes={nomes}
        detalhe
        itens={a.divergentes.map((d) => ({
          linha: d.linha,
          texto: d.valores.map((v) => `${n2(v.odd)} (${v.votos}x)`).join(' · '),
        }))}
      />
      <Grupo
        titulo="Só uma leitura viu"
        dica="Entrou na análise, mas sem confirmação."
        nomes={nomes}
        itens={a.umaLeitura.map((linha) => ({ linha }))}
      />
      <Grupo
        titulo="Faltou o outro lado"
        dica="O mercado veio incompleto: uma odd não foi lida, ou o print cortou a linha."
        nomes={nomes}
        itens={a.semOutroLado.map((linha) => ({ linha }))}
      />
      <Grupo
        titulo="Tiradas da análise"
        dica="Leitura impossível ou contraditória: não entram no cálculo."
        nomes={nomes}
        itens={a.foraDaAnalise.map((f) => ({ linha: f.linha, texto: f.motivo }))}
      />
      <Grupo
        titulo="Vistas uma vez e descartadas"
        dica="Só uma releitura achou e a primeira não: podem ser leitura errada. Se existir no print, adicione à mão."
        nomes={nomes}
        itens={a.descartadas.map((linha) => ({ linha }))}
      />
    </Painel>
  );
}
