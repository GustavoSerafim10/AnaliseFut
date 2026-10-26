import { NOMES_TESE, type ResultadoAnalise } from '@pe/engine';
import { dec, pct } from '../estado';

const CLASSE_DECISAO: Record<ResultadoAnalise['decisao'], string> = {
  BET: 'bet',
  WATCHLIST: 'watch',
  INVESTIGAR: 'investigar',
  NO_BET: 'nobet',
  EXCLUIDO: 'nobet',
};

interface Props {
  resultado: ResultadoAnalise | null;
  pendencias: string[];
}

export function PassoResultado({ resultado: res, pendencias }: Props) {
  if (pendencias.length || !res) {
    return (
      <section className="passo">
        <h2>5. Resultado</h2>
        <div className="caixa alerta">
          Antes de calcular:
          <ul>
            {pendencias.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      </section>
    );
  }
  const m = res.melhor;
  const p = res.previsao;

  return (
    <section className="passo">
      <h2>5. Resultado</h2>

      <div className={`decisao ${CLASSE_DECISAO[res.decisao]}`}>
        <div className="rotulo">{res.rotulo}</div>
        <ul>
          {res.motivos.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        {res.gatilho && <div className="gatilho">Gatilho: {res.gatilho}</div>}
        <div className="miudo">
          DQ {res.dq.efetiva}
          {res.dq.efetiva !== res.dq.informada && ` (informada ${res.dq.informada})`} · Confidence{' '}
          {res.confianca} · Risco {res.risco} · w {res.w ?? '—'}
        </div>
      </div>

      {m && (
        <div className="caixa">
          <h3>Melhor expressão da tese</h3>
          <p>
            <strong>{m.descricao}</strong>
          </p>
          <dl className="numeros">
            <dt>Odd</dt>
            <dd>
              {m.melhorOdd} ({m.casaMelhorOdd})
            </dd>
            <dt>Fair odd</dt>
            <dd>{dec(m.oddJusta)}</dd>
            <dt>Odd mínima</dt>
            <dd>{dec(m.priceGate?.oddMinima)}</dd>
            <dt>P_final</dt>
            <dd>{pct(m.pFinal)}</dd>
            <dt>P_market</dt>
            <dd>{pct(m.pMercado)}</dd>
            <dt>P_modelo</dt>
            <dd>{pct(m.pModelo)}</dd>
            <dt>EV</dt>
            <dd>{pct(m.ev)}</dd>
            <dt>EV mínimo</dt>
            <dd>{pct(m.evMinimo)}</dd>
            <dt>Stake</dt>
            <dd>
              {m.stake
                ? `${pct(m.stake.fracaoBanca, 2)} da banca${m.stake.valor !== undefined ? ` = R$ ${m.stake.valor.toFixed(2)}` : ''}${m.stake.limitadaPeloTeto ? ' (teto 2%)' : ''}`
                : '—'}
            </dd>
          </dl>
          <p className="miudo">Tese: {NOMES_TESE[m.tese]}</p>
        </div>
      )}

      {res.avisos.length > 0 && (
        <div className="caixa alerta">
          {res.avisos.map((a) => (
            <p key={a}>⚠️ {a}</p>
          ))}
        </div>
      )}

      {p && (
        <div className="caixa">
          <h3>Previsão (sai sempre — previsão ≠ aposta)</h3>
          <div className="tabela-rolavel">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>1</th>
                  <th>X</th>
                  <th>2</th>
                  <th>Over 2.5</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['Modelo', p.p1x2.modelo, p.over25.modelo],
                    ['Mercado', p.p1x2.mercado, p.over25.mercado],
                    ['Final', p.p1x2.final, p.over25.final],
                  ] as const
                ).map(([nome, x, o]) => (
                  <tr key={nome}>
                    <td>{nome}</td>
                    <td>{pct(x?.casa)}</td>
                    <td>{pct(x?.empate)}</td>
                    <td>{pct(x?.fora)}</td>
                    <td>{pct(o)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Placares mais prováveis:{' '}
            {p.placares.map((s) => `${s.casa}-${s.fora} (${pct(s.p)})`).join(' · ')}
          </p>
        </div>
      )}

      <div className="caixa">
        <h3>λ (gols esperados)</h3>
        <p>
          Mercado:{' '}
          {res.lambdaMercado
            ? `${dec(res.lambdaMercado.casa)} × ${dec(res.lambdaMercado.fora)} (total ${dec(res.lambdaMercado.total)}) · ${res.lambdaMercado.coerente ? 'coerente' : 'cauda larga: só referência'}`
            : 'sem base'}
        </p>
        <p>
          Modelo: {dec(res.lambdaModelo.original.casa)} × {dec(res.lambdaModelo.original.fora)} →
          ajustado {dec(res.lambdaModelo.ajustado.casa)} × {dec(res.lambdaModelo.ajustado.fora)}
        </p>
        {res.lambdaModelo.ajustes.map((a) => (
          <p key={a} className="miudo">
            • {a}
          </p>
        ))}
        {res.dq.motivos.map((a) => (
          <p key={a} className="miudo">
            • DQ: {a}
          </p>
        ))}
      </div>

      {res.varredura && (
        <div className="caixa">
          <h3>Varredura — top 5</h3>
          <div className="tabela-rolavel">
            <table>
              <thead>
                <tr>
                  <th>Mercado</th>
                  <th>Odd</th>
                  <th>Margem</th>
                  <th>P_mod</th>
                  <th>P_mkt</th>
                  <th>P_final</th>
                  <th>EV</th>
                </tr>
              </thead>
              <tbody>
                {res.varredura.top5.map((a) => (
                  <tr key={a.chave}>
                    <td>
                      {a.descricao.replace('Ganha se: ', '')}
                      <div className="miudo">
                        {NOMES_TESE[a.tese]}
                        {a.representanteDaTese ? '' : ' (mesma tese)'}
                      </div>
                    </td>
                    <td>
                      {a.melhorOdd}
                      <div className="miudo">{a.casaMelhorOdd}</div>
                    </td>
                    <td>{pct(a.margem)}</td>
                    <td>{pct(a.pModelo)}</td>
                    <td>{pct(a.pMercado)}</td>
                    <td>{pct(a.pFinal)}</td>
                    <td className={a.ev > 0 ? 'positivo' : 'negativo'}>{pct(a.ev)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary>
              Todos os avaliados ({res.varredura.avaliadas.length}) e descartados (
              {res.varredura.descartados.length})
            </summary>
            <h4>Avaliados</h4>
            <ul className="miudo">
              {res.varredura.avaliadas.map((a) => (
                <li key={a.chave}>
                  {a.descricao.replace('Ganha se: ', '')} @ {a.melhorOdd}: EV {pct(a.ev)} · margem{' '}
                  {pct(a.margem)} · de-vig {a.metodoDevig}
                </li>
              ))}
            </ul>
            <h4>Descartados</h4>
            <ul className="miudo">
              {res.varredura.descartados.map((d, i) => (
                <li key={`${d.chave}-${i}`}>
                  {d.descricao.replace('Ganha se: ', '')}
                  {d.casa ? ` (${d.casa})` : ''}: {d.motivo}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {res.sensibilidade && (
        <div className="caixa">
          <h3>Sensibilidade: {res.sensibilidade.classe}</h3>
          <ul className="miudo">
            {res.sensibilidade.cenarios.map((c) => (
              <li key={c.nome}>
                {c.nome}: P_modelo {pct(c.pModelo)} · EV {pct(c.ev)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
