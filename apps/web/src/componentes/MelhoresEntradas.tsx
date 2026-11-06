/**
 * A resposta principal da análise: as apostas com mais chance de green, com odd de 1,40 a 2,00,
 * que as estatísticas sustentam e que pagam acima do acerto mínimo da odd.
 */
import {
  JOGOS_MIN_NICHO,
  ODD_MAX_ENTRADA,
  ODD_MIN_ENTRADA,
  type EntradaSugerida,
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

function Cartao({
  e,
  n,
  podeEntrar,
  onEntrar,
}: {
  e: EntradaSugerida;
  n: number;
  podeEntrar: boolean;
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
      {podeEntrar && (
        <button className="entrada-botao" onClick={onEntrar}>
          Entrei nessa
        </button>
      )}
    </li>
  );
}

export function MelhoresEntradas({
  d,
  podeEntrar,
  onEntrar,
}: {
  d: Derivado;
  podeEntrar: boolean;
  onEntrar: (e: EntradaSugerida) => void;
}) {
  const [verRecusadas, setVerRecusadas] = useState(false);
  const r = d.entradas;
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
          <strong>Não aposte agora:</strong> {r.bloqueio}. A lista fica só para acompanhar.
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
                podeEntrar={podeEntrar && !r.bloqueio}
                onEntrar={() => onEntrar(e)}
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
    </section>
  );
}
