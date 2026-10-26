import type { DQ } from '@pe/engine';
import type { Dispatch, SetStateAction } from 'react';
import { dec, type Rascunho, type StatsForm } from '../estado';
import { lambdaDoRascunho } from '../lambda';

const DESCRICAO_DQ: Record<DQ, string> = {
  A: 'liga top, ≥10 jogos, xG, escalação provável, várias casas (com Pinnacle/Betfair)',
  B: '≥6 jogos, xG ou finalizações, desfalques conhecidos, odds em ≥2 casas',
  C: '4–5 jogos, sem xG, alguma incerteza',
  D: '≤3 jogos, liga pouco coberta ou grande mudança de elenco/técnico → sem BET',
  E: 'sem base para λ ou sem odds confiáveis → NO BET automático',
};

const CAMPOS: [keyof StatsForm, string][] = [
  ['jogos', 'Jogos'],
  ['golsPro', 'Gols pró/jogo'],
  ['golsContra', 'Gols contra/jogo'],
  ['xg', 'xG/jogo'],
  ['chutesNoAlvo', 'Chutes no alvo/jogo'],
  ['chutesNoAlvoContra', 'Chutes no alvo contra/jogo'],
];

interface Props {
  r: Rascunho;
  setR: Dispatch<SetStateAction<Rascunho>>;
}

export function PassoJogo({ r, setR }: Props) {
  const jogo = (campo: keyof Rascunho['jogo'], v: string) =>
    setR((x) => ({ ...x, jogo: { ...x.jogo, [campo]: v } }));
  const lambda = <K extends keyof Rascunho['lambda']>(campo: K, v: Rascunho['lambda'][K]) =>
    setR((x) => ({ ...x, lambda: { ...x.lambda, [campo]: v } }));
  const stats = (time: 'statsCasa' | 'statsFora', campo: keyof StatsForm, v: string) =>
    setR((x) => ({ ...x, lambda: { ...x.lambda, [time]: { ...x.lambda[time], [campo]: v } } }));
  const lam = lambdaDoRascunho(r);

  return (
    <section className="passo">
      <h2>1. Jogo</h2>
      <div className="grade2">
        <label>
          Mandante
          <input
            value={r.jogo.casa}
            onChange={(e) => jogo('casa', e.target.value)}
            placeholder="Aston Villa"
          />
        </label>
        <label>
          Visitante
          <input
            value={r.jogo.fora}
            onChange={(e) => jogo('fora', e.target.value)}
            placeholder="Viking"
          />
        </label>
        <label>
          Competição
          <input
            value={r.jogo.competicao}
            onChange={(e) => jogo('competicao', e.target.value)}
            placeholder="Conference League"
          />
        </label>
        <label>
          Data
          <input type="date" value={r.jogo.data} onChange={(e) => jogo('data', e.target.value)} />
        </label>
        <label>
          Hora do início
          <input type="time" value={r.jogo.hora} onChange={(e) => jogo('hora', e.target.value)} />
        </label>
        <label>
          Data Quality (sua avaliação)
          <select value={r.dq} onChange={(e) => setR((x) => ({ ...x, dq: e.target.value as DQ }))}>
            {(['A', 'B', 'C', 'D', 'E'] as DQ[]).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="dica">
        {DESCRICAO_DQ[r.dq]}. O motor ainda rebaixa a DQ pelas odds (1 casa → no máximo C).
      </p>

      <h3>λ do modelo</h3>
      <div className="abas-mini">
        <button
          className={r.lambda.modo === 'stats' ? 'ativo' : ''}
          onClick={() => lambda('modo', 'stats')}
        >
          Pelas estatísticas
        </button>
        <button
          className={r.lambda.modo === 'manual' ? 'ativo' : ''}
          onClick={() => lambda('modo', 'manual')}
        >
          Digitar λ
        </button>
      </div>

      {r.lambda.modo === 'manual' ? (
        <div className="grade2">
          <label>
            λ mandante
            <input
              inputMode="decimal"
              value={r.lambda.manualCasa}
              onChange={(e) => lambda('manualCasa', e.target.value)}
            />
          </label>
          <label>
            λ visitante
            <input
              inputMode="decimal"
              value={r.lambda.manualFora}
              onChange={(e) => lambda('manualFora', e.target.value)}
            />
          </label>
        </div>
      ) : (
        <>
          <div className="tabela-rolavel">
            <table className="stats">
              <thead>
                <tr>
                  <th></th>
                  <th>{r.jogo.casa || 'Mandante'}</th>
                  <th>{r.jogo.fora || 'Visitante'}</th>
                </tr>
              </thead>
              <tbody>
                {CAMPOS.map(([campo, rotulo]) => (
                  <tr key={campo}>
                    <td>{rotulo}</td>
                    {(['statsCasa', 'statsFora'] as const).map((t) => (
                      <td key={t}>
                        <input
                          inputMode="decimal"
                          value={r.lambda[t][campo]}
                          onChange={(e) => stats(t, campo, e.target.value)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grade2">
            <label>
              Média de gols por time (liga)
              <input
                inputMode="decimal"
                value={r.lambda.mediaGols}
                onChange={(e) => lambda('mediaGols', e.target.value)}
              />
            </label>
            <label>
              Mando
              <input
                inputMode="decimal"
                value={r.lambda.mando}
                onChange={(e) => lambda('mando', e.target.value)}
              />
            </label>
          </div>
          <p className="dica">
            xG e chutes no alvo são opcionais; sem eles o modelo declara a limitação. Prior neutro →
            Confidence no máximo Baixa.
          </p>
        </>
      )}

      {lam.ok ? (
        <div className="caixa ok">
          λ modelo: <strong>{dec(lam.lambdas.casa)}</strong> ×{' '}
          <strong>{dec(lam.lambdas.fora)}</strong>
          <ul className="miudo">
            {lam.declaracoes.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="caixa alerta">{lam.erro}</div>
      )}
    </section>
  );
}
