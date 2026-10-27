/**
 * Comparativo de odds (V4.0): para cada mercado avaliado, odd paga × odd justa, probabilidade
 * do mercado sem margem × P_true usada pelo motor, EV e status. "Acima do gate" só quando o
 * critério real do motor (EV ≥ gate) é satisfeito.
 */
import { useState } from 'react';
import type { Derivado } from '../dados';
import { Dica, Icone } from './ui';

const p1 = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
const n2 = (x: number) => x.toFixed(2).replace('.', ',');
const LIMITE = 8;

export function ComparativoOdds({ d }: { d: Derivado }) {
  const [todos, setTodos] = useState(false);
  const v = d.v4;
  const linhas = v?.avaliadas ?? [];
  const visiveis = todos ? linhas : linhas.slice(0, LIMITE);
  return (
    <section className="painel">
      <div className="painel-titulo">
        <Icone nome="mercado" /> Comparativo de odds
        <span className="painel-sub">{linhas.length} mercados</span>
      </div>
      {!linhas.length ? (
        <p className="vazio">
          {v
            ? 'Nenhum mercado tem referência e casa mole para comparar (veja os descartados abaixo).'
            : 'Aguardando jogo e odds.'}
        </p>
      ) : (
        <div className="tabela-rolavel">
          <table className="tabela-odds">
            <thead>
              <tr>
                <th>Mercado</th>
                <th>Odd</th>
                <th>
                  Justa <Dica termo="justa" />
                </th>
                <th>
                  P mercado × P_true <Dica termo="ptrue" />
                </th>
                <th>
                  EV <Dica termo="ev" />
                </th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((a, i) => {
                const acima = a.evMinimo !== null && a.ev >= a.evMinimo;
                const escolhida = v?.melhor?.chave === a.chave;
                const status =
                  escolhida && v?.decisao === 'BET'
                    ? { t: 'BET', c: 'bet' }
                    : escolhida && v?.decisao !== 'NO_BET'
                      ? { t: v!.decisao.replace('_', ' '), c: 'watch' }
                      : acima
                        ? { t: 'ACIMA DO GATE', c: 'ok' }
                        : { t: 'SEM EDGE', c: 'neutro' };
                return (
                  <tr key={a.chave} style={{ animationDelay: `${i * 40}ms` }}>
                    <td>
                      <div className="mercado-nome">
                        {a.descricao.replace('Ganha se: ', '').replace(/\.$/, '')}
                      </div>
                      <div className="miudo">
                        {a.nivel} · {a.estrategia}
                      </div>
                    </td>
                    <td>
                      <b>{a.melhorOdd}</b>
                      <div className="miudo">{a.casaMelhorOdd}</div>
                    </td>
                    <td>{n2(a.oddJusta)}</td>
                    <td className="col-barras">
                      <div
                        className="barra-dupla"
                        title={`P mercado ${p1(a.pConsenso)} · P_true ${p1(a.pTrue)}`}
                      >
                        <span className="bd-mercado" style={{ width: `${a.pConsenso * 100}%` }} />
                        <span className="bd-true" style={{ width: `${a.pTrue * 100}%` }} />
                      </div>
                      <div className="miudo">
                        {p1(a.pConsenso)} · <b>{p1(a.pTrue)}</b>
                      </div>
                    </td>
                    <td className={acima ? 'positivo' : 'negativo'}>
                      {a.ev >= 0 ? '+' : ''}
                      {p1(a.ev)}
                    </td>
                    <td>
                      <span className={`chip chip-${status.c}`}>{status.t}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {linhas.length > LIMITE && (
        <button className="discreto mini" onClick={() => setTodos((x) => !x)}>
          {todos ? 'mostrar menos' : `mostrar todos (${linhas.length})`}
        </button>
      )}
      <div className="legenda">
        <span>
          <i className="bd-mercado" /> mercado sem margem
        </span>
        <span>
          <i className="bd-true" /> P_true do motor
        </span>
      </div>
    </section>
  );
}
