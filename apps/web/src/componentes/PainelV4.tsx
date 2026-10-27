import { NOMES_ESTRATEGIA, NOMES_REFERENCIA, type ResultadoV4 } from '@pe/engine';
import { dec, pct } from '../estado';
import type { PropsAba } from '../abas/tipos';

const CLASSE: Record<ResultadoV4['decisao'], string> = {
  BET: 'bet',
  WATCHLIST: 'watch',
  INVESTIGAR: 'investigar',
  NO_BET: 'nobet',
  EXCLUIDO: 'nobet',
};

const FILTRO: Record<string, string> = {
  concorda: 'concorda ✓',
  neutro: 'neutro',
  discorda: 'discorda ⚠️',
  'no preço': 'é parte do preço (R3)',
  'sem modelo': 'sem estatísticas',
};

const hora = (iso?: string) => (iso ? iso.slice(11, 16) : '—');
const sem = (s: string) => s.replace('Ganha se: ', '');

/** Decisão do protocolo V4.0: referência afiada × casa mole. */
export function PainelV4({ r, setR, d }: PropsAba) {
  const v = d.v4;
  if (!v) return null;
  const m = v.melhor;
  return (
    <>
      <div className={`decisao ${CLASSE[v.decisao]}`}>
        <div className="rotulo">{v.rotulo}</div>
        <ul>
          {v.motivos.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        {v.gatilho && <div className="gatilho">Gatilho: {v.gatilho}</div>}
        <div className="miudo">
          Protocolo V4.0 · {NOMES_REFERENCIA[v.referencia.nivel]}
          {v.referencia.afiadas.length > 0 && ` (${v.referencia.afiadas.join(', ')})`} · casas
          moles: {v.referencia.moles.join(', ') || '—'}
        </div>
      </div>

      {d.atrasos.length > 0 && (
        <div className="caixa ok">
          <strong>Atraso da casa mole (S1):</strong>
          <ul>
            {d.atrasos.map((a, i) => (
              <li key={i}>
                {a.movimento.casa} moveu "{a.movimento.descricao}" de {a.movimento.de} para{' '}
                {a.movimento.para} ({hora(a.movimento.horarioDe)}→{hora(a.movimento.horarioPara)}
                ), e a {a.casaMole} ainda paga {a.oddMole} ({hora(a.horarioMole)}).
              </li>
            ))}
          </ul>
        </div>
      )}
      {v.avisos.length > 0 && (
        <div className="caixa alerta">
          <ul>
            {v.avisos.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      )}

      {m && (
        <div className="caixa">
          <h3>Melhor preço encontrado</h3>
          <p>
            <strong>{sem(m.descricao)}</strong>
          </p>
          <dl className="numeros">
            <dt>Odd</dt>
            <dd>
              {m.melhorOdd} ({m.casaMelhorOdd}, {hora(m.horarioColeta)})
              {m.oddEfetiva !== m.melhorOdd && ` · ${dec(m.oddEfetiva)} sem a comissão`}
            </dd>
            <dt>P_true</dt>
            <dd>
              {pct(m.pTrue)} · {m.fonteP}
              {m.horarioReferencia && ` (${hora(m.horarioReferencia)})`}
            </dd>
            <dt>Odd justa</dt>
            <dd>{dec(m.oddJusta)}</dd>
            <dt>EV</dt>
            <dd>
              {pct(m.ev)} (mínimo {pct(m.evMinimo)})
            </dd>
            <dt>Odd mínima</dt>
            <dd>{dec(m.oddMinima)}</dd>
            <dt>Estratégia</dt>
            <dd>{NOMES_ESTRATEGIA[m.estrategia]}</dd>
            <dt>Filtro do modelo</dt>
            <dd>
              {FILTRO[m.filtro]}
              {m.pModelo !== null && m.filtro !== 'no preço' && ` (modelo ${pct(m.pModelo)})`}
            </dd>
            <dt>Stake</dt>
            <dd>
              {m.stake
                ? `${pct(m.stake.fracaoBanca, 2)} da banca${m.stake.valor !== undefined ? ` = R$ ${m.stake.valor.toFixed(2)}` : ''} (Kelly × ${dec(m.stake.fracaoKelly, 3)})`
                : '—'}
            </dd>
          </dl>
          {m.stake?.ajustes.length ? <p className="miudo">{m.stake.ajustes.join(' · ')}</p> : null}
        </div>
      )}

      <label className="check">
        <input
          type="checkbox"
          checked={r.noticia}
          onChange={(e) => setR((x) => ({ ...x, noticia: e.target.checked }))}
        />
        <span>
          Entrada motivada por notícia (S2)
          <span className="dica bloco">
            Escalação confirmada, lesão de última hora, rotação. Se a odd já se moveu a favor da
            tese, está no preço: PASS. O fato novo vai em "Fato concreto…" na seção Modelo.
          </span>
        </span>
      </label>

      <details className="caixa">
        <summary>
          V4.0: top 5, todos os mercados ({v.avaliadas.length}) e descartados (
          {v.descartados.length})
        </summary>
        <div className="tabela-rolavel">
          <table>
            <thead>
              <tr>
                <th>Mercado</th>
                <th>Odd</th>
                <th>P_true</th>
                <th>Justa</th>
                <th>EV</th>
                <th>Mín.</th>
              </tr>
            </thead>
            <tbody>
              {v.top5.map((a) => (
                <tr key={a.chave}>
                  <td>
                    {sem(a.descricao)}
                    <div className="miudo">
                      {a.nivel} · {a.estrategia} · {a.tese}
                    </div>
                  </td>
                  <td>
                    {a.melhorOdd}
                    <div className="miudo">{a.casaMelhorOdd}</div>
                  </td>
                  <td>{pct(a.pTrue)}</td>
                  <td>{dec(a.oddJusta)}</td>
                  <td className={a.ev >= (a.evMinimo ?? Infinity) ? 'positivo' : 'negativo'}>
                    {pct(a.ev)}
                  </td>
                  <td>{dec(a.oddMinima)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h4>Todos os avaliados</h4>
        <ul className="miudo">
          {v.avaliadas.map((a) => (
            <li key={a.chave}>
              {sem(a.descricao)} @ {a.melhorOdd} ({a.casaMelhorOdd}): EV {pct(a.ev)} · gate{' '}
              {pct(a.evMinimo)} · {a.nivel} · P_true {pct(a.pTrue)} ({a.fonteP})
            </li>
          ))}
        </ul>
        <h4>Descartados</h4>
        <ul className="miudo">
          {v.descartados.map((x, i) => (
            <li key={`${x.chave}-${i}`}>
              {sem(x.descricao)}: {x.motivo}
            </li>
          ))}
        </ul>
        {d.movimentos.length > 0 && (
          <>
            <h4>Movimentos entre prints</h4>
            <ul className="miudo">
              {d.movimentos.map((x, i) => (
                <li key={i}>
                  {x.casa}: {x.descricao} {x.de} → {x.para} ({hora(x.horarioDe)}→
                  {hora(x.horarioPara)})
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
    </>
  );
}
