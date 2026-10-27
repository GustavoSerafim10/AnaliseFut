/**
 * Comparativo de odds (V4.0): odd paga × odd justa, EV e status de cada mercado avaliado,
 * com uma barra fina P mercado (sem margem) × P_true. "Acima do gate" só quando o critério
 * real do motor (EV ≥ gate) é satisfeito.
 */
import type { AvaliacaoV4, LinhaOdd } from '@pe/engine';
import { useState } from 'react';
import type { Derivado } from '../dados';
import { Dica, Icone } from './ui';

const p1 = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
const n2 = (x: number) => x.toFixed(2);
const LIMITE = 8;

const LADO_1X2: Record<string, string> = { '1': 'Mandante', X: 'Empate', '2': 'Visitante' };
const OU: Record<string, string> = { over: 'Over', under: 'Under' };
const linhaTxt = (l?: number) => (l === undefined ? '' : ` ${l > 0 ? '+' : ''}${l}`);

/** "1X2 - Mandante", "O/U 2.5 - Over", "BTTS - Sim"… (o "Ganha se" completo fica no title). */
export function rotuloCurto(l: LinhaOdd): string {
  const lado = l.lado.trim();
  const tempo = l.periodo === 'FT' ? '' : ` (${l.periodo})`;
  const time = l.time === 'casa' ? 'Mandante' : l.time === 'fora' ? 'Visitante' : '';
  const ou = OU[lado.toLowerCase()] ?? lado;
  let t: string;
  switch (l.mercado) {
    case '1X2':
      t = `1X2 - ${LADO_1X2[lado.toUpperCase()] ?? lado}`;
      break;
    case 'DC':
      t = `Dupla chance - ${lado.toUpperCase()}`;
      break;
    case 'DNB':
      t = `Empate anula - ${LADO_1X2[lado] ?? lado}`;
      break;
    case 'AH':
      t = `AH${linhaTxt(l.linha)} - ${lado === 'casa' ? 'Mandante' : 'Visitante'}`;
      break;
    case 'total':
      t = `O/U ${l.linha} - ${ou}`;
      break;
    case 'total_time':
      t = `Gols ${time} ${l.linha} - ${ou}`;
      break;
    case 'ambas':
      t = `BTTS - ${lado.toLowerCase() === 'sim' ? 'Sim' : 'Não'}`;
      break;
    case 'escanteios_total':
      t = `Escanteios ${l.linha} - ${ou}`;
      break;
    case 'escanteios_time':
      t = `Escanteios ${time} ${l.linha} - ${ou}`;
      break;
    case 'escanteios_ah':
      t = `Escanteios AH${linhaTxt(l.linha)} - ${lado === 'casa' ? 'Mandante' : 'Visitante'}`;
      break;
    case 'escanteios_1x2':
      t = `Escanteios 1X2 - ${LADO_1X2[lado.toUpperCase()] ?? lado}`;
      break;
    case 'cartoes_total':
      t = `Cartões ${l.linha} - ${ou}`;
      break;
    case 'cartoes_time':
      t = `Cartões ${time} ${l.linha} - ${ou}`;
      break;
    case 'cartoes_1x2':
      t = `Cartões 1X2 - ${LADO_1X2[lado.toUpperCase()] ?? lado}`;
      break;
    default:
      t = `${l.mercado} - ${lado}`;
  }
  return t + tempo;
}

function IconeMercado({ a }: { a: AvaliacaoV4 }) {
  const m = a.linha.mercado;
  const nome =
    m.startsWith('escanteios') || m.startsWith('cartoes')
      ? 'alvo'
      : m === 'ambas'
        ? 'modelo'
        : 'bola';
  return (
    <span className="icone-mercado">
      <Icone nome={nome} tamanho={16} />
    </span>
  );
}

export function ComparativoOdds({ d }: { d: Derivado }) {
  const [todos, setTodos] = useState(false);
  const v = d.v4;
  const linhas = v?.avaliadas ?? [];
  const visiveis = todos ? linhas : linhas.slice(0, LIMITE);
  const casas = [...new Set(linhas.map((a) => a.casaMelhorOdd))];
  return (
    <section className="painel">
      <div className="painel-titulo">
        <Icone nome="engrenagem" /> Comparativo de odds
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
                <th>Odd {casas.length === 1 ? casas[0] : 'casa'}</th>
                <th>
                  Odd justa <Dica termo="justa" />
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
                    ? { t: 'BET', c: 'bet', i: 'alvo' as const }
                    : escolhida && v?.decisao !== 'NO_BET'
                      ? { t: v!.decisao.replace('_', ' '), c: 'watch', i: 'olho' as const }
                      : acima
                        ? { t: 'ACIMA DO GATE', c: 'ok', i: null }
                        : { t: 'SEM EDGE', c: 'neutro', i: null };
                return (
                  <tr key={a.chave} style={{ animationDelay: `${i * 40}ms` }}>
                    <td title={a.descricao}>
                      <div className="mercado-linha">
                        <IconeMercado a={a} />
                        <div>
                          <div className="mercado-nome">{rotuloCurto(a.linha)}</div>
                          <div
                            className="barra-dupla"
                            title={`P mercado sem margem ${p1(a.pConsenso)} · P_true ${p1(a.pTrue)}`}
                          >
                            <span
                              className="bd-mercado"
                              style={{ width: `${a.pConsenso * 100}%` }}
                            />
                            <span className="bd-true" style={{ width: `${a.pTrue * 100}%` }} />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {n2(a.melhorOdd)}
                      {casas.length > 1 && <div className="miudo">{a.casaMelhorOdd}</div>}
                    </td>
                    <td>{n2(a.oddJusta)}</td>
                    <td className={a.ev > 0 ? 'positivo' : 'negativo'}>
                      {a.ev > 0 ? '+' : ''}
                      {p1(a.ev)}
                    </td>
                    <td>
                      <span className={`chip chip-${status.c}`}>
                        {status.i && <Icone nome={status.i} tamanho={14} />}
                        {status.t}
                      </span>
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
    </section>
  );
}
