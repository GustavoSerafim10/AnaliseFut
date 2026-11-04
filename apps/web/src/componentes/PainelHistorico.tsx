/**
 * Painel do Histórico: cartões de Entradas/Green/Red/Winrate/ROI/Unidades/EV/Odd e a curva
 * das unidades acumuladas. Tudo vem de painel() em historico.ts (1 unidade por entrada).
 */
import { useState, type ReactNode } from 'react';
import type { Painel } from '../historico';
import { Icone, type NomeIcone } from './ui';

const n2 = (x: number) => x.toFixed(2).replace('.', ',');
const p1 = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
const sinal = (x: number, f: (v: number) => string) =>
  `${x > 0 ? '+' : x < 0 ? '−' : ''}${f(Math.abs(x))}`;
const dataBr = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/');

function Cartao({
  icone,
  titulo,
  valor,
  tom,
  children,
}: {
  icone: NomeIcone;
  titulo: string;
  valor: ReactNode;
  tom?: 'ok' | 'erro' | 'amarelo';
  children?: ReactNode;
}) {
  return (
    <div className={`kpi ${tom ? `kpi-${tom}` : ''}`}>
      <div className="kpi-topo">
        <span className="kpi-icone">
          <Icone nome={icone} />
        </span>
        <span className="kpi-titulo">{titulo}</span>
      </div>
      <div className="kpi-valor">{valor}</div>
      {children && <div className="kpi-detalhe">{children}</div>}
    </div>
  );
}

const tomDe = (x: number | null) => (x === null || x === 0 ? undefined : x > 0 ? 'ok' : 'erro');

export function CartoesPainel({ p }: { p: Painel }) {
  const vazio = <span className="kpi-vazio">—</span>;
  return (
    <div className="faixa-kpi">
      <Cartao icone="bola" titulo="Entradas" valor={p.entradas}>
        <span>
          apuradas <b>{p.entradas - p.pendentes}</b>
        </span>
        <span>
          pendentes <b>{p.pendentes}</b>
        </span>
      </Cartao>
      <Cartao icone="trofeu" titulo="Green" valor={p.green} tom={p.green ? 'ok' : undefined} />
      <Cartao icone="proibido" titulo="Red" valor={p.red} tom={p.red ? 'erro' : undefined} />
      <Cartao icone="relogio" titulo="Devolvidas" valor={p.devolvidas} />
      <Cartao icone="alvo" titulo="Winrate" valor={p.winrate === null ? vazio : p1(p.winrate)}>
        <span>green ÷ (green + red)</span>
      </Cartao>
      <Cartao
        icone="modelo"
        titulo="Unidades"
        valor={p.green + p.red + p.devolvidas ? sinal(p.unidades, n2) : vazio}
        tom={tomDe(p.unidades)}
      >
        <span>1 un. por entrada</span>
      </Cartao>
      <Cartao
        icone="cerebro"
        titulo="ROI"
        valor={p.roi === null ? vazio : sinal(p.roi, p1)}
        tom={tomDe(p.roi)}
      />
      <Cartao
        icone="lupa"
        titulo="EV médio"
        valor={p.evMedio === null ? vazio : sinal(p.evMedio, p1)}
      >
        <span>na hora da análise</span>
      </Cartao>
      <Cartao
        icone="info"
        titulo="Odd média"
        valor={p.oddMedia === null ? vazio : n2(p.oddMedia)}
      />
    </div>
  );
}

/** Curva das unidades acumuladas: uma série só, linha de zero, tooltip por ponto. */
export function CurvaUnidades({ p, titulo }: { p: Painel; titulo: string }) {
  const [foco, setFoco] = useState<number | null>(null);
  if (p.curva.length === 0) return null;
  const pontos = [{ id: 'inicio', jogo: 'Início', data: '', lucro: 0, acumulado: 0 }, ...p.curva];
  const L = 600;
  const A = 180;
  const M = 12;
  const vals = pontos.map((x) => x.acumulado);
  const max = Math.max(0, ...vals);
  const min = Math.min(0, ...vals);
  const faixa = max - min || 1;
  const x = (i: number) => M + (i / (pontos.length - 1)) * (L - 2 * M);
  const y = (v: number) => M + ((max - v) / faixa) * (A - 2 * M);
  const linha = pontos.map((pt, i) => `${i ? 'L' : 'M'}${x(i)},${y(pt.acumulado)}`).join(' ');
  const ultimo = pontos[pontos.length - 1].acumulado;
  const f = foco === null ? null : pontos[foco];
  return (
    <div className="caixa curva-unidades">
      <h3>
        {titulo}:{' '}
        <span className={ultimo >= 0 ? 'positivo' : 'negativo'}>{sinal(ultimo, n2)} un.</span>
      </h3>
      <div className="curva-area">
        <svg
          viewBox={`0 0 ${L} ${A}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${titulo}, ${sinal(ultimo, n2)} unidades depois de ${p.curva.length} entradas`}
          onMouseLeave={() => setFoco(null)}
        >
          <line className="curva-zero" x1={M} x2={L - M} y1={y(0)} y2={y(0)} />
          <text className="curva-eixo" textAnchor="end" x={L - M} y={y(0) - 4}>
            0
          </text>
          <path className="curva-linha" d={linha} />
          {pontos.map((pt, i) => (
            <circle
              key={pt.id}
              className={`curva-ponto ${i === foco ? 'ativo' : ''}`}
              cx={x(i)}
              cy={y(pt.acumulado)}
              r={i === foco ? 6 : 4}
            />
          ))}
          {foco !== null && (
            <line className="curva-mira" x1={x(foco)} x2={x(foco)} y1={M} y2={A - M} />
          )}
          {pontos.map((pt, i) => (
            <rect
              key={`alvo-${pt.id}`}
              x={x(i) - (L - 2 * M) / (pontos.length - 1 || 1) / 2}
              y={0}
              width={(L - 2 * M) / (pontos.length - 1 || 1)}
              height={A}
              fill="transparent"
              onMouseEnter={() => setFoco(i)}
              onClick={() => setFoco(i)}
            />
          ))}
        </svg>
        {f && (
          <div
            className="curva-dica"
            style={{
              left: `${(x(foco!) / L) * 100}%`,
              transform: `translateX(${foco! > pontos.length / 2 ? '-100%' : '0'})`,
            }}
          >
            <strong>{f.jogo}</strong>
            {f.data && <span>{dataBr(f.data)}</span>}
            {foco! > 0 && <span>nesta entrada: {sinal(f.lucro, n2)} un.</span>}
            <span>acumulado: {sinal(f.acumulado, n2)} un.</span>
          </div>
        )}
      </div>
      <p className="miudo">
        Cada ponto é uma entrada apurada, na ordem dos jogos. Passe o mouse (ou toque) para ver o
        jogo.
      </p>
    </div>
  );
}
