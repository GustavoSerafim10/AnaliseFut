/**
 * Grafo da decisão: o caminho que o motor V4.0 realmente percorreu, das fontes de preço
 * (referência, casas moles, modelo) ao P_true/EV, aos mercados ranqueados e à decisão.
 * Cada nó lê o ResultadoV4; o caminho aceso é o do mercado escolhido pelo motor.
 * Sem tempos de execução: o motor não mede isso.
 */
import type { Derivado } from '../dados';
import { rotuloCurto } from './ComparativoOdds';
import { Icone } from './ui';

const MAX_MERCADOS = 6;
const W = 920;
const NO_H = 50;
const PASSO = 62;
const COL = { fonte: 16, hub: 236, mercado: 446, decisao: 764 };
const LARG = { fonte: 176, hub: 168, mercado: 262, decisao: 140 };

const pct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
const n2 = (x: number) => x.toFixed(2).replace('.', ',');

/** curva horizontal suave entre a saída de um nó e a entrada de outro */
const curva = (x1: number, y1: number, x2: number, y2: number) => {
  const m = (x1 + x2) / 2;
  return `M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2}`;
};

function No({
  x,
  y,
  w,
  titulo,
  sub,
  classe = '',
}: {
  x: number;
  y: number;
  w: number;
  titulo: string;
  sub: string;
  classe?: string;
}) {
  return (
    // posição no grupo de fora: a animação de entrada (transform do CSS) vai no de dentro
    <g transform={`translate(${x},${y - NO_H / 2})`}>
      <g className={`gd-no ${classe}`}>
        <rect width={w} height={NO_H} rx={10} />
        <text x={12} y={20} className="gd-titulo">
          {titulo}
        </text>
        <text x={12} y={37} className="gd-sub">
          {sub}
        </text>
      </g>
    </g>
  );
}

export function GrafoDecisao({ d }: { d: Derivado }) {
  const v = d.v4;
  if (!v) return null;

  const mercados = v.avaliadas.slice(0, MAX_MERCADOS);
  const resto = v.avaliadas.length - mercados.length;
  const linhasMercado = mercados.length + (resto > 0 ? 1 : 0) + (v.descartados.length ? 1 : 0);
  const H = Math.max(linhasMercado, 3) * PASSO + 24;
  const yMercado = (i: number) => 12 + PASSO / 2 + i * PASSO + (H - 24 - linhasMercado * PASSO) / 2;
  const meio = H / 2;
  const yFonte = (i: number) => meio + (i - 1) * PASSO * 1.1;

  const ref = v.referencia;
  const fontes = [
    {
      titulo: `Referência ${ref.nivel}`,
      sub: ref.afiadas.length
        ? ref.afiadas.join(', ')
        : ref.nivel === 'R2'
          ? 'consenso de 4+ casas'
          : 'sem casa afiada',
      ok: ref.nivel === 'R1' || ref.nivel === 'R2',
    },
    {
      titulo: 'Casas moles',
      sub: ref.moles.length ? ref.moles.join(', ') : 'nenhuma',
      ok: ref.moles.length > 0,
    },
    {
      titulo: 'Modelo',
      sub: d.lambda
        ? `λ ${n2(d.lambda.lambdas.casa)} × ${n2(d.lambda.lambdas.fora)} · DQ ${d.dq.dq}`
        : 'sem estatísticas',
      ok: !!d.lambda,
    },
  ];
  const escolhida = v.melhor?.chave;
  const acima = (a: (typeof mercados)[number]) => a.evMinimo !== null && a.ev >= a.evMinimo;
  const decisao = v.decisao;
  const classeDecisao = decisao.toLowerCase().replace('_', '-');
  const iEscolhida = mercados.findIndex((a) => a.chave === escolhida);

  const xHubSai = COL.hub + LARG.hub;
  const xMercSai = COL.mercado + LARG.mercado;

  return (
    <section className="painel grafo-decisao">
      <div className="painel-titulo">
        <Icone nome="modelo" /> Grafo da decisão
        <span className="painel-sub">
          {v.avaliadas.length} avaliados · {v.descartados.length} descartados
        </span>
      </div>
      <div className="tabela-rolavel">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="gd-svg"
          role="img"
          aria-label={`Caminho da decisão: ${fontes.map((f) => f.titulo).join(', ')} → P_true e EV → ${mercados.length} mercados → ${decisao.replace('_', ' ')}`}
        >
          {/* arestas */}
          {fontes.map((f, i) => (
            <path
              key={f.titulo}
              className={`gd-aresta ${f.ok ? 'ativa' : ''}`}
              d={curva(COL.fonte + LARG.fonte, yFonte(i), COL.hub, meio)}
            />
          ))}
          {mercados.map((a, i) => (
            <path
              key={a.chave}
              className={`gd-aresta ${a.chave === escolhida ? 'escolhida' : acima(a) ? 'ativa' : ''}`}
              d={curva(xHubSai, meio, COL.mercado, yMercado(i))}
            />
          ))}
          {iEscolhida >= 0 && (
            <path
              className={`gd-aresta escolhida ${classeDecisao}`}
              d={curva(xMercSai, yMercado(iEscolhida), COL.decisao, meio)}
            />
          )}

          {/* nós */}
          {fontes.map((f, i) => (
            <No
              key={f.titulo}
              x={COL.fonte}
              y={yFonte(i)}
              w={LARG.fonte}
              titulo={f.titulo}
              sub={f.sub}
              classe={f.ok ? 'ok' : 'alerta'}
            />
          ))}
          <No
            x={COL.hub}
            y={meio}
            w={LARG.hub}
            titulo="De-vig · P_true · EV"
            sub={`${v.avaliadas.length + v.descartados.length} seleções`}
            classe="hub"
          />
          {mercados.map((a, i) => (
            <No
              key={a.chave}
              x={COL.mercado}
              y={yMercado(i)}
              w={LARG.mercado}
              titulo={`${i + 1}º ${rotuloCurto(a.linha)}`}
              sub={`@ ${a.melhorOdd.toFixed(2)} ${a.casaMelhorOdd} · EV ${a.ev > 0 ? '+' : ''}${pct(a.ev)}${a.evMinimo !== null ? ` · gate ${pct(a.evMinimo)}` : ''}`}
              classe={a.chave === escolhida ? 'escolhida' : acima(a) ? 'ok' : 'neutro'}
            />
          ))}
          {resto > 0 && (
            <No
              x={COL.mercado}
              y={yMercado(mercados.length)}
              w={LARG.mercado}
              titulo={`+${resto} mercados`}
              sub="abaixo no ranking"
              classe="neutro fantasma"
            />
          )}
          {v.descartados.length > 0 && (
            <No
              x={COL.mercado}
              y={yMercado(mercados.length + (resto > 0 ? 1 : 0))}
              w={LARG.mercado}
              titulo={`${v.descartados.length} descartados`}
              sub="fora da comparação (motivos no V4.0)"
              classe="neutro fantasma"
            />
          )}
          <No
            x={COL.decisao}
            y={meio}
            w={LARG.decisao}
            titulo={decisao.replace('_', ' ')}
            sub={iEscolhida >= 0 ? `${iEscolhida + 1}º do ranking` : 'nenhum candidato'}
            classe={`decisao ${classeDecisao}`}
          />
        </svg>
      </div>
      <p className="miudo">
        Ordem do ranking = folga do EV sobre o gate de cada mercado (a mesma do motor). Caminho
        aceso: o mercado que o motor levou à decisão.
      </p>
    </section>
  );
}
