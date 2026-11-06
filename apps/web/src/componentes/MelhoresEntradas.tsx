/**
 * A resposta principal da análise: as apostas com mais chance de green, com odd de 1,40 a 2,00,
 * que as estatísticas sustentam e que pagam acima do acerto mínimo da odd.
 */
import {
  JOGOS_MIN_NICHO,
  ODD_MAX_ENTRADA,
  ODD_MIN_ENTRADA,
  type EntradaSugerida,
  type OpcaoAposta,
  type StatusEntradas,
} from '@pe/engine';
import { useState } from 'react';
import type { Derivado } from '../dados';

const sem = (s: string) => s.replace('Ganha se: ', '');
const dec = (x: number) => x.toFixed(2).replace('.', ',');
const pct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
const faixa = `${dec(ODD_MIN_ENTRADA)} a ${dec(ODD_MAX_ENTRADA)}`;

const MENSAGEM: Record<Exclude<StatusEntradas, 'ok'>, string> = {
  jogo_iniciado: 'O jogo já começou: a lista vale só antes do início.',
  sem_estatisticas:
    'Faltam as estatísticas dos dois times (SofaScore ou SuperScore). Sem elas não dá para indicar entrada.',
  dados_fracos: `Poucos dados dos times para confiar na estimativa. Em escanteios e cartões, o mínimo é de ${JOGOS_MIN_NICHO} jogos.`,
  sem_mercados: `Nenhum mercado com os dois lados lidos e odd de ${faixa}. Cole mais prints da casa.`,
};

/** O que é preciso para registrar uma aposta, venha da lista ou do seletor. */
export type EscolhaEntrada = Pick<
  EntradaSugerida,
  'chave' | 'linha' | 'descricao' | 'odd' | 'casa' | 'chance' | 'ev'
> &
  Partial<Pick<EntradaSugerida, 'stake' | 'stakeValor'>>;

function Cartao({
  e,
  n,
  registrada,
  onEntrar,
}: {
  e: EntradaSugerida;
  n: number;
  registrada: boolean;
  onEntrar: () => void;
}) {
  return (
    <li className={`entrada-item ${e.forca}`}>
      <div className="entrada-chance">
        <strong>{Math.round(e.chance * 100)}%</strong>
        <span>chance estimada</span>
      </div>
      <div className="entrada-corpo">
        <div className="entrada-topo">
          <span className="entrada-n">{n}º</span>
          <span className={`entrada-selo ${e.forca}`}>
            {e.forca === 'forte' ? 'Sinal forte' : 'Sinal médio'}
          </span>
        </div>
        <h4>{sem(e.descricao)}</h4>
        <p>
          <b>
            @ {dec(e.odd)} na {e.casa}
          </b>{' '}
          · a odd pede {pct(e.minimo)} de acerto
        </p>
        <p className="miudo">
          Estatísticas {pct(e.pModelo)} · {e.referenciaAfiada ? 'referência afiada' : 'mercado'}{' '}
          {pct(e.pMercado)} · {e.casas} casa{e.casas > 1 ? 's' : ''}
          {' · '}
          aposta sugerida {pct(e.stake).replace(',0%', '%')} da banca
          {e.stakeValor !== undefined && ` = R$ ${dec(e.stakeValor)}`}
        </p>
      </div>
      {registrada ? (
        <span className="entrada-registrada">✓ Registrada</span>
      ) : (
        <button className="entrada-botao" onClick={onEntrar}>
          Entrei nessa
        </button>
      )}
    </li>
  );
}

export function MelhoresEntradas({
  d,
  registradas,
  onEntrar,
}: {
  d: Derivado;
  /** apostas já registradas neste jogo: o mesmo mercado não entra duas vezes */
  registradas: Set<string>;
  onEntrar: (e: EscolhaEntrada, aviso?: string) => void;
}) {
  const [verRecusadas, setVerRecusadas] = useState(false);
  const [escolhida, setEscolhida] = useState('');
  const r = d.entradas;
  const avisoBanca = r?.bloqueio
    ? `${r.bloqueio}: a trava da banca pede para não apostar agora. Registre só se você já apostou, para a banca ficar certa.`
    : undefined;
  const livres = d.opcoes.filter((o) => !registradas.has(o.chave));
  const opcao = livres.find((o) => o.chave === escolhida);
  const avisoDaOpcao = (o: OpcaoAposta) => {
    const motivo = r?.recusadas.find((x) => x.chave === o.selecao)?.motivo;
    const fora = motivo
      ? `Esta aposta ficou fora da lista: ${motivo}.`
      : `Esta aposta não está entre as Melhores entradas${o.temEstimativa ? '' : ', e o site não tem estimativa de chance para ela'}.`;
    return [fora, 'Ela conta no seu painel normalmente.', avisoBanca].filter(Boolean).join(' ');
  };
  return (
    <section className="painel melhores-entradas" aria-label="Melhores entradas">
      <div className="entradas-cabecalho">
        <h3>Melhores entradas</h3>
        <span className="miudo">odds de {faixa}, da maior para a menor chance</span>
      </div>
      {!r && (
        <p className="entradas-vazio">
          Preencha o jogo e cole as odds e as estatísticas para ver as entradas.
        </p>
      )}
      {r && r.status !== 'ok' && <p className="entradas-vazio">{MENSAGEM[r.status]}</p>}
      {r?.bloqueio && r.entradas.length > 0 && (
        <div className="caixa alerta">
          <strong>Não aposte agora:</strong> {r.bloqueio}. Se você já apostou, registre abaixo para
          a banca ficar certa.
        </div>
      )}
      {r?.status === 'ok' && r.entradas.length === 0 && (
        <p className="entradas-vazio">
          <strong>Hoje este jogo não tem entrada.</strong> Nenhum mercado teve estatísticas e odd
          boas ao mesmo tempo. Passar o jogo também é uma boa decisão.
        </p>
      )}
      {r && r.entradas.length > 0 && (
        <>
          <ol className="entradas-lista">
            {r.entradas.map((e, i) => (
              <Cartao
                key={e.chave}
                e={e}
                n={i + 1}
                registrada={registradas.has(`${e.casa.trim().toLowerCase()}#${e.chave}`)}
                onEntrar={() => onEntrar(e, avisoBanca)}
              />
            ))}
          </ol>
          <p className="miudo">
            Escolha uma por jogo: as apostas do mesmo jogo costumam ganhar ou perder juntas. A
            chance é uma estimativa, não garantia. Veja no Histórico quanto cada faixa acertou de
            verdade.
          </p>
        </>
      )}
      {r && r.recusadas.length > 0 && (
        <>
          <button className="discreto" onClick={() => setVerRecusadas((x) => !x)}>
            {verRecusadas ? 'Esconder' : 'Ver'} os {r.recusadas.length} mercados que ficaram de fora
          </button>
          {verRecusadas && (
            <ul className="miudo entradas-recusadas">
              {r.recusadas.map((x) => (
                <li key={x.chave}>
                  <b>
                    {sem(x.descricao)} @ {dec(x.odd)}
                  </b>
                  : {x.motivo}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {livres.length > 0 && (
        <div className="entrada-escolher">
          <label>
            Entrou em outra aposta? Escolha qualquer mercado lido, mesmo com NO BET
            <select value={escolhida} onChange={(x) => setEscolhida(x.target.value)}>
              <option value="">Selecione a aposta</option>
              {livres.map((o) => (
                <option key={o.chave} value={o.chave}>
                  {sem(o.descricao)} @ {dec(o.odd)} · {o.casa}
                  {o.temEstimativa && ` · chance ${Math.round(o.chance * 100)}%`}
                </option>
              ))}
            </select>
          </label>
          <button
            className="entrada-botao"
            disabled={!opcao}
            onClick={() => {
              if (!opcao) return;
              const naLista = r?.entradas.find(
                (x) => x.chave === opcao.selecao && x.casa === opcao.casa && x.odd === opcao.odd,
              );
              if (naLista) onEntrar(naLista, avisoBanca);
              else onEntrar(opcao, avisoDaOpcao(opcao));
              setEscolhida('');
            }}
          >
            Entrei nessa
          </button>
        </div>
      )}
    </section>
  );
}
