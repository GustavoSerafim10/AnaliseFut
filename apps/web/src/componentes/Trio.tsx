import { useId } from 'react';

/**
 * Homenagem sem imagem de ninguém: três camisas desenhadas em SVG.
 * R10 com a canarinho, Ney com a 11 do Barça e Messi com a 10 da Argentina.
 */
const CAMISA =
  'M22 6 L9 11 L2 25 L11 30 L15 24 L15 60 L49 60 L49 24 L53 30 L62 25 L55 11 L42 6 Q32 15 22 6 Z';

interface Camisa {
  nome: string;
  numero: string;
  /** listras verticais [cor A, cor B]; uma cor = lisa */
  cores: [string] | [string, string];
  gola: string;
  corNumero: string;
}

export const CAMISAS: Camisa[] = [
  { nome: 'R10', numero: '10', cores: ['#ffd60a'], gola: '#009c3b', corNumero: '#009c3b' },
  {
    nome: 'NEY',
    numero: '11',
    cores: ['#a50044', '#004d98'],
    gola: '#edbb00',
    corNumero: '#edbb00',
  },
  {
    nome: 'MESSI',
    numero: '10',
    cores: ['#ffffff', '#75aadb'],
    gola: '#1b2a4a',
    corNumero: '#1b2a4a',
  },
];

function UmaCamisa({ c, x, rot }: { c: Camisa; x: number; rot: number }) {
  const id = useId().replace(/:/g, '');
  const listrada = c.cores.length === 2;
  return (
    <g transform={`translate(${x} 0) rotate(${rot} 32 34)`}>
      {listrada && (
        <defs>
          <pattern id={id} width="12" height="64" patternUnits="userSpaceOnUse">
            <rect width="6" height="64" fill={c.cores[0]} />
            <rect x="6" width="6" height="64" fill={c.cores[1]} />
          </pattern>
        </defs>
      )}
      <path
        d={CAMISA}
        fill={listrada ? `url(#${id})` : c.cores[0]}
        stroke="rgba(0,0,0,.35)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M22 6 Q32 15 42 6" fill="none" stroke={c.gola} strokeWidth="3" />
      <path d="M2 25 L11 30 M62 25 L53 30" stroke={c.gola} strokeWidth="3" />
      <text
        x="32"
        y="47"
        textAnchor="middle"
        fontFamily="'Bebas Neue', Impact, sans-serif"
        fontSize="24"
        fill={c.corNumero}
        stroke={listrada ? 'rgba(255,255,255,.85)' : 'none'}
        strokeWidth={listrada ? 0.8 : 0}
        paintOrder="stroke"
      >
        {c.numero}
      </text>
    </g>
  );
}

/** As três camisas lado a lado; `nomes` mostra R10 · NEY · MESSI embaixo. */
export function Trio({ tamanho = 40, nomes = false }: { tamanho?: number; nomes?: boolean }) {
  const altura = nomes ? 78 : 64;
  return (
    <svg
      className="trio"
      viewBox={`0 0 160 ${altura}`}
      width={(tamanho * 160) / 64}
      height={(tamanho * altura) / 64}
      role="img"
      aria-label="Camisas 10 do Ronaldinho, 11 do Neymar e 10 do Messi"
    >
      <UmaCamisa c={CAMISAS[0]} x={0} rot={-8} />
      <UmaCamisa c={CAMISAS[2]} x={96} rot={8} />
      <UmaCamisa c={CAMISAS[1]} x={48} rot={0} />
      {nomes &&
        CAMISAS.map((c, i) => (
          <text
            key={c.nome}
            x={[32, 80, 128][i]}
            y="76"
            textAnchor="middle"
            fontFamily="'Bebas Neue', Impact, sans-serif"
            fontSize="13"
            letterSpacing="1"
            fill="currentColor"
          >
            {c.nome}
          </text>
        ))}
    </svg>
  );
}
