/**
 * Faixa de indicadores quantitativos. Todo número vem do motor (d.lambda, d.resultado,
 * d.v4, d.dq); sem dado, o card diz "indisponível" em vez de preencher.
 */
import type { ReactNode } from 'react';
import type { Derivado } from '../dados';
import { Barra, Dica, Icone, Numero, type NomeIcone, GLOSSARIO } from './ui';

const p0 = (x: number) => `${Math.round(x * 100)}%`;
const n2 = (x: number) => x.toFixed(2).replace('.', ',');
const p1 = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
const pp = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1).replace('.', ',')} pp`;

const NOTA_DQ: Record<string, number> = { A: 1, B: 0.8, C: 0.6, D: 0.4, E: 0.2 };

function Card({
  icone,
  titulo,
  termo,
  destaque,
  children,
  rodape,
  tom,
}: {
  icone: NomeIcone;
  titulo: ReactNode;
  termo?: keyof typeof GLOSSARIO;
  destaque: ReactNode;
  children?: ReactNode;
  rodape?: ReactNode;
  tom?: 'ciano' | 'amarelo' | 'ok' | 'erro';
}) {
  return (
    <div className={`kpi ${tom ? `kpi-${tom}` : ''}`}>
      <div className="kpi-topo">
        <span className="kpi-icone">
          <Icone nome={icone} />
        </span>
        <span className="kpi-titulo">{titulo}</span>
        {termo && <Dica termo={termo} />}
      </div>
      <div className="kpi-valor">{destaque}</div>
      {children && <div className="kpi-detalhe">{children}</div>}
      {rodape}
    </div>
  );
}

function Tres({ p }: { p: { casa: number; empate: number; fora: number } }) {
  return (
    <>
      <span>
        MAND <b>{p0(p.casa)}</b>
      </span>
      <span>
        EMP <b>{p0(p.empate)}</b>
      </span>
      <span>
        VIS <b>{p0(p.fora)}</b>
      </span>
    </>
  );
}

export function Indicadores({ d }: { d: Derivado }) {
  const res = d.resultado;
  // λ do modelo com a sua faixa; o ajustado (9.4, em direção ao mercado) aparece embaixo
  const lam = d.lambda?.lambdas;
  const ajustado = res?.lambdaModelo.ajustado;
  const faixa = d.lambda?.faixa;
  const prev = res?.previsao;
  const m = d.v4?.melhor;
  const edge = m ? m.pTrue - 1 / m.melhorOdd : null;
  const indisponivel = <span className="kpi-vazio">indisponível</span>;
  const maxL = Math.max(3, lam?.casa ?? 0, lam?.fora ?? 0);

  return (
    <div className="faixa-kpi">
      {(['casa', 'fora'] as const).map((t) => (
        <Card
          key={t}
          icone="lambda"
          titulo={
            <>
              <span className="sem-caixa">λ</span> {t === 'casa' ? 'mandante' : 'visitante'}
            </>
          }
          termo="lambda"
          tom="ciano"
          destaque={lam ? <Numero valor={lam[t]} formato={n2} /> : indisponivel}
          rodape={
            lam && (
              <Barra valor={lam[t] / maxL} cor={t === 'casa' ? 'var(--amarelo)' : 'var(--ciano)'} />
            )
          }
        >
          {faixa && <span>faixa {`${n2(faixa[t][0])} – ${n2(faixa[t][1])}`}</span>}
          {ajustado && lam && Math.abs(ajustado[t] - lam[t]) > 0.005 && (
            <span>ajustado {n2(ajustado[t])}</span>
          )}
        </Card>
      ))}
      <Card icone="modelo" titulo="P modelo" destaque={prev ? '1X2' : indisponivel}>
        {prev && <Tres p={prev.p1x2.modelo} />}
      </Card>
      <Card
        icone="barras"
        titulo="P mercado"
        termo="devig"
        destaque={d.mercado1x2 ? '1X2' : indisponivel}
      >
        {d.mercado1x2 ? <Tres p={d.mercado1x2} /> : d.motivoSem1x2 && <span>{d.motivoSem1x2}</span>}
      </Card>
      <Card
        icone="raio"
        titulo="Edge"
        termo="edge"
        tom={edge !== null && edge > 0 ? 'ok' : undefined}
        destaque={<Numero valor={edge} formato={pp} vazio="—" />}
      >
        {m ? m.descricao.replace('Ganha se: ', '').replace(/\.$/, '') : 'sem mercado comparável'}
      </Card>
      <Card
        icone="ev"
        titulo="EV"
        termo="ev"
        tom={m && m.evMinimo !== null && m.ev >= m.evMinimo ? 'ok' : undefined}
        destaque={<Numero valor={m?.ev} formato={p1} vazio="—" />}
      >
        {m ? `gate ${m.evMinimo === null ? '—' : p1(m.evMinimo)} · ${m.nivel}` : 'sem valor'}
      </Card>
      <Card
        icone="escudo"
        titulo="Data Quality"
        termo="dq"
        tom="amarelo"
        destaque={d.dqFinal.dq}
        rodape={
          <Barra valor={NOTA_DQ[d.dqFinal.dq] ?? 0} cor="linear-gradient(90deg,#22c55e,#a3e635)" />
        }
      >
        {d.modeloCasa.stats && d.modeloFora.stats
          ? `estatísticas ${d.dq.dq}${d.dqFinal.dq !== d.dq.dq ? ` · ${d.dqFinal.motivos.join('; ')}` : ''}`
          : 'sem estatísticas'}
      </Card>
    </div>
  );
}
