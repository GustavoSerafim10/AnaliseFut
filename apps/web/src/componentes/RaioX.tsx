/**
 * Raio-X dos times (abas de estatísticas): os números consolidados das fontes lidas,
 * desenhados lado a lado. Duelo de atributos, radar ofensivo, distribuição de gols e
 * placares mais prováveis. Os dois últimos vêm da matriz Dixon-Coles do próprio motor
 * (matrizPlacares) com o λ do modelo; nada é estimado na tela.
 */
import { matrizPlacares, placaresMaisProvaveis } from '@pe/engine';
import type { CampoStat } from '@pe/parsers';
import type { Derivado } from '../dados';
import { Icone } from './ui';

type Time = 'casa' | 'fora';

/** [campo, rótulo curto, menor é melhor] */
const DUELO: [CampoStat, string, boolean][] = [
  ['golsPorJogo', 'Gols por jogo', false],
  ['golsSofridosPorJogo', 'Gols sofridos por jogo', true],
  ['xg', 'xG', false],
  ['chutesNoAlvo', 'Chutes no alvo por jogo', false],
  ['finalizacoes', 'Finalizações', false],
  ['grandesChances', 'Grandes chances', false],
  ['escanteios', 'Escanteios', false],
  ['posse', 'Posse de bola (%)', false],
  ['jogosSemSofrer', 'Jogos sem sofrer gols', false],
  ['cartoesAmarelos', 'Cartões amarelos por jogo', true],
];

/** eixos do radar: todos "mais é melhor" no ataque */
const RADAR: [CampoStat, string][] = [
  ['golsPorJogo', 'Gols'],
  ['xg', 'xG'],
  ['chutesNoAlvo', 'No alvo'],
  ['finalizacoes', 'Finalizações'],
  ['grandesChances', 'Grandes chances'],
  ['escanteios', 'Escanteios'],
  ['posse', 'Posse'],
];

const GOLS = 6; // 0…5 e "6+"
const fmt = (x: number) => String(Math.round(x * 100) / 100).replace('.', ',');
const pct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;

function Radar({
  eixos,
  nomes,
}: {
  eixos: { rotulo: string; casa: number; fora: number }[];
  nomes: Record<Time, string>;
}) {
  const R = 92;
  const C = 130;
  const ponto = (i: number, f: number) => {
    const a = -Math.PI / 2 + (i / eixos.length) * Math.PI * 2;
    return [C + Math.cos(a) * R * f, C + Math.sin(a) * R * f];
  };
  // cada eixo é relativo ao maior dos dois times (o radar compara, não mede)
  const forma = (t: Time) =>
    eixos
      .map((e, i) => ponto(i, Math.max(e.casa, e.fora) ? e[t] / Math.max(e.casa, e.fora) : 0))
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ');
  return (
    <svg
      className="radar"
      viewBox="-36 0 332 260"
      role="img"
      aria-label={`Radar ofensivo: ${nomes.casa} em amarelo, ${nomes.fora} em ciano`}
    >
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon
          key={f}
          className="radar-grade"
          points={eixos.map((_, i) => ponto(i, f).join(',')).join(' ')}
        />
      ))}
      {eixos.map((e, i) => {
        const [x, y] = ponto(i, 1);
        const [tx, ty] = ponto(i, 1.2);
        return (
          <g key={e.rotulo}>
            <line className="radar-eixo" x1={C} y1={C} x2={x} y2={y} />
            <text
              className="radar-rotulo"
              x={tx}
              y={ty}
              textAnchor={Math.abs(tx - C) < 8 ? 'middle' : tx > C ? 'start' : 'end'}
              dominantBaseline="middle"
            >
              {e.rotulo}
            </text>
          </g>
        );
      })}
      <polygon className="radar-forma radar-fora" points={forma('fora')} />
      <polygon className="radar-forma radar-casa" points={forma('casa')} />
    </svg>
  );
}

export function RaioX({ d, nomes }: { d: Derivado; nomes: Record<Time, string> }) {
  // gols por jogo: o mesmo número que entra no λ (total ÷ partidas, ou o "por jogo" lido)
  const doModelo: Partial<Record<CampoStat, Record<Time, number | undefined>>> = {
    golsPorJogo: { casa: d.modeloCasa.stats?.golsPro, fora: d.modeloFora.stats?.golsPro },
    golsSofridosPorJogo: {
      casa: d.modeloCasa.stats?.golsContra,
      fora: d.modeloFora.stats?.golsContra,
    },
  };
  const val = (c: CampoStat, t: Time) => doModelo[c]?.[t] ?? d.tabela[c]?.[t]?.valor;
  const par = (c: CampoStat) => {
    const casa = val(c, 'casa');
    const fora = val(c, 'fora');
    return casa === undefined || fora === undefined ? null : { casa, fora };
  };
  const duelo = DUELO.flatMap(([c, rotulo, menor]) => {
    const p = par(c);
    return p ? [{ c, rotulo, menor, ...p }] : [];
  });
  const eixos = RADAR.flatMap(([c, rotulo]) => {
    const p = par(c);
    return p ? [{ rotulo, ...p }] : [];
  });

  // gols: matriz do motor com o λ ajustado (o mesmo que precifica os mercados)
  const lambdas = d.resultado?.lambdaModelo.ajustado ?? d.lambda?.lambdas;
  const matriz = lambdas ? matrizPlacares(lambdas.casa, lambdas.fora) : null;
  const marginal = (t: Time) => {
    if (!matriz) return [];
    const p = Array.from({ length: GOLS + 1 }, () => 0);
    matriz.forEach((linha, i) =>
      linha.forEach((v, j) => (p[Math.min(GOLS, t === 'casa' ? i : j)] += v)),
    );
    return p;
  };
  const dist = { casa: marginal('casa'), fora: marginal('fora') };
  const maxDist = Math.max(...dist.casa, ...dist.fora, 0.01);
  const placares = matriz ? placaresMaisProvaveis(matriz, 5) : [];

  if (!duelo.length && !matriz) return null;

  return (
    <section className="raio-x">
      <div className="painel-titulo">
        <Icone nome="barras" /> Raio-X dos times
        <span className="painel-sub">
          <span className="legenda-time casa">{nomes.casa}</span>
          <span className="legenda-time fora">{nomes.fora}</span>
        </span>
      </div>
      <div className="raio-x-grade">
        {duelo.length > 0 && (
          <div className="painel rx-duelo">
            <h4>Duelo de atributos</h4>
            <ul>
              {duelo.map((l, i) => {
                const max = Math.max(l.casa, l.fora) || 1;
                const melhor =
                  l.casa === l.fora ? null : l.casa > l.fora !== l.menor ? 'casa' : 'fora';
                return (
                  <li key={l.c} style={{ animationDelay: `${i * 50}ms` }}>
                    <span className={`rx-valor ${melhor === 'casa' ? 'melhor' : ''}`}>
                      {fmt(l.casa)}
                    </span>
                    <span className="rx-barra rx-esq">
                      <span className="casa" style={{ width: `${(l.casa / max) * 100}%` }} />
                    </span>
                    <span className="rx-rotulo">{l.rotulo}</span>
                    <span className="rx-barra">
                      <span className="fora" style={{ width: `${(l.fora / max) * 100}%` }} />
                    </span>
                    <span className={`rx-valor ${melhor === 'fora' ? 'melhor' : ''}`}>
                      {fmt(l.fora)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="miudo">Valores consolidados das fontes lidas (e das suas correções).</p>
          </div>
        )}

        {eixos.length >= 3 && (
          <div className="painel rx-radar">
            <h4>Perfil ofensivo</h4>
            <Radar eixos={eixos} nomes={nomes} />
            <p className="miudo">Cada eixo é relativo ao melhor dos dois times naquele dado.</p>
          </div>
        )}

        {matriz && lambdas && (
          <div className="painel rx-gols">
            <h4>
              Gols esperados{' '}
              <span className="miudo">
                {d.resultado ? 'λ ajustado' : 'λ'} {fmt(lambdas.casa)} × {fmt(lambdas.fora)}
              </span>
            </h4>
            <div
              className="rx-colunas"
              role="img"
              aria-label="Probabilidade de cada número de gols por time"
            >
              {dist.casa.map((pc, k) => (
                <div key={k} className="rx-coluna">
                  <div className="rx-par">
                    <span
                      className="casa"
                      style={{ height: `${(pc / maxDist) * 100}%`, animationDelay: `${k * 60}ms` }}
                      title={`${nomes.casa}: ${k === GOLS ? `${GOLS}+` : k} gol(s) · ${pct(pc)}`}
                    />
                    <span
                      className="fora"
                      style={{
                        height: `${(dist.fora[k] / maxDist) * 100}%`,
                        animationDelay: `${k * 60 + 30}ms`,
                      }}
                      title={`${nomes.fora}: ${k === GOLS ? `${GOLS}+` : k} gol(s) · ${pct(dist.fora[k])}`}
                    />
                  </div>
                  <span className="rx-k">{k === GOLS ? `${GOLS}+` : k}</span>
                </div>
              ))}
            </div>
            <p className="miudo">Matriz Dixon-Coles do motor com o λ do modelo.</p>
          </div>
        )}

        {placares.length > 0 && (
          <div className="painel rx-placares">
            <h4>Placares mais prováveis</h4>
            <ol>
              {placares.map((p, i) => (
                <li key={`${p.casa}-${p.fora}`}>
                  <span className="rx-placar">
                    {p.casa} <small>×</small> {p.fora}
                  </span>
                  <span className="prob-trilho">
                    <span
                      className="prob-barra prob-mercado"
                      style={{
                        width: `${(p.p / placares[0].p) * 100}%`,
                        animationDelay: `${i * 70}ms`,
                      }}
                    />
                  </span>
                  <span className="rx-p">{pct(p.p)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}
