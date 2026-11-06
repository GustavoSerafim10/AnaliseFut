/** Monta a múltipla com apostas de vários jogos; a montagem continua ao abrir outro jogo. */
import { useState } from 'react';
import { isoLocal, num } from '../estado';
import {
  apurarMultipla,
  balancoMultiplas,
  resumirMultipla,
  type Multipla,
  type PernaMultipla,
} from '../multiplas';
import type { EntradaHistorico } from '../historico';

const dec = (x: number) => x.toFixed(2).replace('.', ',');
const pct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
const sem = (s: string) => s.replace('Ganha se: ', '');
const sinal = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${dec(Math.abs(x))}`;

export function MontarMultipla({
  pernas,
  erro,
  bloqueio,
  onRemover,
  onLimpar,
  onRegistrar,
}: {
  pernas: PernaMultipla[];
  erro?: string | null;
  /** trava da banca ativa: avisa, mas deixa registrar o que já foi apostado */
  bloqueio?: string;
  onRemover: (i: number) => void;
  onLimpar: () => void;
  onRegistrar: (m: Multipla) => void;
}) {
  const r = resumirMultipla(pernas);
  const [oddPega, setOddPega] = useState('');
  const [casa, setCasa] = useState('');
  const [valor, setValor] = useState('');
  const [registrando, setRegistrando] = useState(false);
  if (!pernas.length && !erro) return null;
  const casaFinal = casa.trim() || pernas[0]?.casa || '';
  const oddFinal = num(oddPega) ?? r.odd;
  const iniciou = pernas.some((p) => Date.parse(p.inicio) <= Date.now());
  return (
    <section className="painel montar-multipla" aria-label="Montar múltipla">
      <div className="entradas-cabecalho">
        <h3>Montando múltipla</h3>
        {pernas.length > 0 && (
          <button className="discreto mini" onClick={onLimpar}>
            limpar
          </button>
        )}
      </div>
      {erro && <div className="caixa alerta">{erro}</div>}
      {pernas.length > 0 && (
        <>
          <ol className="multipla-pernas">
            {pernas.map((p, i) => (
              <li key={`${p.jogo}-${p.inicio}`}>
                <span>
                  <strong>{sem(p.descricao)}</strong>
                  <small>{p.jogo}</small>
                </span>
                <b>{dec(p.odd)}</b>
                <button
                  className="discreto mini"
                  aria-label={`Remover ${p.jogo}`}
                  onClick={() => onRemover(i)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ol>
          {pernas.length === 1 ? (
            <p className="miudo">Abra outro jogo e adicione mais uma aposta.</p>
          ) : (
            <>
              <dl className="multipla-resumo">
                <div>
                  <dt>Odd total</dt>
                  <dd>{dec(r.odd)}</dd>
                </div>
                <div>
                  <dt>Chance de todas baterem</dt>
                  <dd>{r.chance === null ? 'sem estimativa' : pct(r.chance)}</dd>
                </div>
                <div>
                  <dt>A odd pede</dt>
                  <dd>{pct(r.minimo)}</dd>
                </div>
                <div>
                  <dt>Média por R$ 1</dt>
                  <dd className={(r.ev ?? 0) > 0 ? 'positivo' : 'negativo'}>
                    {r.ev === null ? '—' : `${sinal(r.ev)}`}
                  </dd>
                </div>
              </dl>
              <p className="miudo">
                Só paga se todas baterem. A odd sobe, mas a margem da casa também se multiplica e
                um erro de estimativa pesa mais. Sem histórico comprovado, use um valor pequeno.
              </p>
              {iniciou && (
                <div className="caixa alerta">
                  Um dos jogos já começou: confira na casa se essa aposta ainda vale.
                </div>
              )}
              {bloqueio && (
                <div className="caixa alerta">
                  {bloqueio}: a trava da banca pede para não apostar agora. Registre só se já
                  apostou.
                </div>
              )}
              {registrando ? (
                <div className="grade3">
                  <label>
                    Odd total que você pegou
                    <input
                      inputMode="decimal"
                      value={oddPega}
                      placeholder={dec(r.odd)}
                      onChange={(x) => setOddPega(x.target.value)}
                    />
                  </label>
                  <label>
                    Casa
                    <input
                      value={casa}
                      placeholder={pernas[0].casa}
                      onChange={(x) => setCasa(x.target.value)}
                    />
                  </label>
                  <label>
                    Valor (R$)
                    <input
                      inputMode="decimal"
                      value={valor}
                      placeholder="ex.: 1"
                      onChange={(x) => setValor(x.target.value)}
                    />
                  </label>
                  <div className="linha-acoes">
                    <button
                      className="primario"
                      disabled={!(oddFinal > 1) || !casaFinal}
                      onClick={() => {
                        onRegistrar({
                          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
                          criadaEm: isoLocal(new Date()),
                          odd: oddFinal,
                          casa: casaFinal,
                          valor: num(valor),
                          pernas,
                        });
                        setRegistrando(false);
                        setOddPega('');
                        setValor('');
                      }}
                    >
                      ✅ Confirmar múltipla
                    </button>
                    <button className="discreto" onClick={() => setRegistrando(false)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button className="primario" onClick={() => setRegistrando(true)}>
                  Entrei nessa múltipla
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

const SELO = { green: '🟢 GREEN', red: '🔴 RED', devolvida: '⚪ DEVOLVIDA', pendente: '⏳ PENDENTE' };
const SELO_PERNA = {
  green: '🟢',
  'meio-green': '🟢½',
  devolvida: '⚪',
  'meio-red': '🔴½',
  red: '🔴',
  pendente: '⏳',
};

/** O quadro das múltiplas no Histórico: ficam fora do placar de acerto das Melhores entradas. */
export function PainelMultiplas({
  multiplas,
  historico,
  onApagar,
}: {
  multiplas: Multipla[];
  historico: EntradaHistorico[];
  onApagar: (id: string) => void;
}) {
  if (!multiplas.length) return null;
  const b = balancoMultiplas(multiplas, historico);
  return (
    <details className="caixa painel-multiplas">
      <summary>
        <strong>Múltiplas ({b.total})</strong>{' '}
        <span className="miudo">
          {b.green} green · {b.red} red · {b.pendentes} pendente{b.pendentes === 1 ? '' : 's'} ·{' '}
          {sinal(b.unidades)} un.
        </span>
      </summary>
      <p className="dica">
        O resultado sai sozinho dos placares registrados nos jogos. Uma perna perdida já encerra a
        múltipla.
      </p>
      {multiplas.map((m) => {
        const a = apurarMultipla(m, historico);
        return (
          <div key={m.id} className="multipla-linha">
            <div className="multipla-topo">
              <span className={`selo-resultado ${a.situacao}`}>{SELO[a.situacao]}</span>
              <b>
                @ {dec(m.odd)} · {m.casa}
                {m.valor !== undefined && ` · R$ ${dec(m.valor)}`}
              </b>
              {a.lucro !== undefined && <span className="miudo">{sinal(a.lucro)} un.</span>}
              <button
                className="perigo mini"
                onClick={() => confirm('Apagar esta múltipla?') && onApagar(m.id)}
              >
                apagar
              </button>
            </div>
            <ul className="miudo">
              {m.pernas.map((p, i) => (
                <li key={`${p.jogo}-${p.inicio}`}>
                  {SELO_PERNA[a.pernas[i].situacao]} {p.jogo}: {sem(p.descricao)} @ {dec(p.odd)}
                  {a.pernas[i].falta && ` (${a.pernas[i].falta})`}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </details>
  );
}
