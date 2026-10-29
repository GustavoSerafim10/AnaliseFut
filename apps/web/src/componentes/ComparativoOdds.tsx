/**
 * Comparativo de odds (V4.0): odd paga × odd justa, P mercado (sem margem) × P_true, EV
 * contra o gate e status de cada mercado avaliado. "Acima do gate" só quando o critério
 * real do motor (EV ≥ gate) é satisfeito.
 */
import type { AvaliacaoV4, LinhaOdd } from '@pe/engine';
import { useState } from 'react';
import type { Derivado } from '../dados';
import { Dica, Icone } from './ui';

const p1 = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
const n2 = (x: number) => x.toFixed(2);
const LIMITE = 8;
/** escala do medidor de EV: ±10% ocupa meia barra */
const ESCALA_EV = 0.1;

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
    case 'primeiro_gol':
    case 'ultimo_gol':
    case 'primeiro_escanteio': {
      const nome = {
        primeiro_gol: 'Primeiro gol',
        ultimo_gol: 'Último gol',
        primeiro_escanteio: 'Primeiro escanteio',
      }[l.mercado];
      const quem = { casa: 'Mandante', fora: 'Visitante', nenhum: 'Nenhum' }[lado.toLowerCase()];
      t = `${nome} - ${quem ?? lado}`;
      break;
    }
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

/** Probabilidade com barra proporcional (0–100%). */
function Prob({ p, cor }: { p: number; cor: 'mercado' | 'true' }) {
  return (
    <div className="prob-cel">
      <span>{p1(p)}</span>
      <span className="prob-trilho" aria-hidden>
        <span className={`prob-barra prob-${cor}`} style={{ width: `${p * 100}%` }} />
      </span>
    </div>
  );
}

/** EV numa barra centrada no zero, com a marca do gate do próprio mercado. */
function MedidorEv({ ev, gate }: { ev: number; gate: number | null }) {
  const pos = (x: number) => 50 + (Math.max(-ESCALA_EV, Math.min(ESCALA_EV, x)) / ESCALA_EV) * 50;
  const fim = pos(ev);
  return (
    <span className="medidor-ev" aria-hidden>
      <span
        className={`medidor-barra ${ev > 0 ? 'positivo' : 'negativo'}`}
        style={{ left: `${Math.min(50, fim)}%`, width: `${Math.abs(fim - 50)}%` }}
      />
      {gate !== null && <span className="medidor-gate" style={{ left: `${pos(gate)}%` }} />}
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
                  P mercado <Dica termo="devig" />
                </th>
                <th>
                  P motor <Dica termo="ptrue" />
                </th>
                <th>
                  EV × gate <Dica termo="gate" />
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
                        <div className="mercado-nome">{rotuloCurto(a.linha)}</div>
                      </div>
                    </td>
                    <td>
                      {n2(a.melhorOdd)}
                      {casas.length > 1 && <div className="miudo">{a.casaMelhorOdd}</div>}
                    </td>
                    <td>{n2(a.oddJusta)}</td>
                    <td>
                      <Prob p={a.pConsenso} cor="mercado" />
                    </td>
                    <td>
                      <Prob p={a.pTrue} cor="true" />
                    </td>
                    <td
                      className={`ev-cel ${a.ev > 0 ? 'positivo' : 'negativo'}`}
                      title={a.evMinimo === null ? undefined : `gate ${p1(a.evMinimo)}`}
                    >
                      {a.ev > 0 ? '+' : ''}
                      {p1(a.ev)}
                      <MedidorEv ev={a.ev} gate={a.evMinimo} />
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
