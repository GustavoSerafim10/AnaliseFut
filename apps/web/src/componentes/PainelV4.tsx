import { pct } from '../estado';
import type { PropsAba } from '../abas/tipos';
import { Icone } from './ui';

const hora = (iso?: string) => (iso ? iso.slice(11, 16) : '—');
const sem = (s: string) => s.replace('Ganha se: ', '');

/**
 * Complementos da V4.0 abaixo do centro de decisão: alerta de atraso da casa mole, marcação
 * de entrada por notícia (S2) e a lista completa de avaliados, descartados e movimentos.
 */
export function PainelV4({ r, setR, d }: PropsAba) {
  const v = d.v4;
  if (!v) return null;
  return (
    <>
      {d.atrasos.length > 0 && (
        <section className="painel painel-atraso">
          <div className="painel-titulo">
            <Icone nome="raio" /> Atraso da casa mole (S1)
          </div>
          <ul>
            {d.atrasos.map((a, i) => (
              <li key={i}>
                {a.movimento.casa} moveu "{a.movimento.descricao}" de {a.movimento.de} para{' '}
                {a.movimento.para} ({hora(a.movimento.horarioDe)}→{hora(a.movimento.horarioPara)}
                ), e a {a.casaMole} ainda paga {a.oddMole} ({hora(a.horarioMole)}).
              </li>
            ))}
          </ul>
        </section>
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
          Todos os mercados ({v.avaliadas.length}), descartados ({v.descartados.length})
          {d.movimentos.length > 0 && ` e movimentos (${d.movimentos.length})`}
        </summary>
        <h4>Avaliados</h4>
        <ul className="miudo">
          {v.avaliadas.map((a) => (
            <li key={a.chave}>
              {sem(a.descricao)} @ {a.melhorOdd} ({a.casaMelhorOdd}): EV {pct(a.ev)} · gate{' '}
              {pct(a.evMinimo)} · {a.nivel} · P_true {pct(a.pTrue)} ({a.fonteP}) · tese {a.tese}
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
