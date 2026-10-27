import { useId } from 'react';
import { CAMISAS } from './Trio';

/**
 * Fundo animado: gramado à noite e três jogadores estilizados (só as camisas, nenhum rosto
 * nem imagem de pessoa real). R10 toca para o Ney, o Ney para o Messi, o Messi chuta e a
 * rede balança, em loop. Tudo em CSS (estilos.css, seção "estádio"); para com reduzir
 * movimento. Com figurinhas (fotos escolhidas no aparelho), o rosto vira a foto.
 */
const POSICOES: [number, number][] = [
  [170, 330],
  [385, 262],
  [585, 322],
];

function Jogador({ i, listra, foto }: { i: number; listra: string; foto?: string | null }) {
  const c = CAMISAS[i];
  const [x, y] = POSICOES[i];
  const listrada = c.cores.length === 2;
  return (
    <g transform={`translate(${x} ${y}) scale(1.5)`}>
      <ellipse cx="0" cy="1" rx="16" ry="4" className="sombra-jogador" />
      <g className="corpo">
        {/* perna de apoio e perna do chute */}
        <path d="M-4 -30 L-6 -2" className="perna" />
        <g className={`chute chute-${i}`}>
          <path d="M4 -30 L6 -2" className="perna" />
          <path d="M6 -2 L11 -1" className="chuteira" />
        </g>
        <path d="M-6 -2 L-11 -1" className="chuteira" />
        <rect x="-9" y="-38" width="18" height="10" rx="2" className="calcao" />
        <path
          d="M-10 -66 L-18 -60 L-15 -52 L-10 -55 L-10 -37 L10 -37 L10 -55 L15 -52 L18 -60 L10 -66 Q0 -60 -10 -66 Z"
          fill={listrada ? `url(#${listra}-${i})` : c.cores[0]}
          stroke={c.gola}
          strokeWidth="1"
        />
        <text x="0" y="-43" textAnchor="middle" className="numero" fill={c.corNumero}>
          {c.numero}
        </text>
        <path d="M-15 -52 L-17 -40 M15 -52 L18 -41" className="braco" />
        {foto ? (
          <>
            <clipPath id={`${listra}-rosto-${i}`}>
              <circle cx="0" cy="-78" r="12" />
            </clipPath>
            <image
              href={foto}
              x="-12"
              y="-90"
              width="24"
              height="24"
              clipPath={`url(#${listra}-rosto-${i})`}
              preserveAspectRatio="xMidYMid slice"
            />
            <circle cx="0" cy="-78" r="12" fill="none" stroke={c.gola} strokeWidth="1.5" />
          </>
        ) : (
          <circle cx="0" cy="-74" r="8" className="cabeca" />
        )}
      </g>
    </g>
  );
}

/** `fotos`: figurinhas escolhidas no aparelho (só locais); sem foto, cabeça estilizada. */
export function Estadio({
  fotos = [],
  comGaleria = false,
}: {
  fotos?: (string | null)[];
  /** com fotos de fundo, o gramado fica translúcido para elas aparecerem */
  comGaleria?: boolean;
}) {
  const listra = useId().replace(/:/g, '');
  return (
    <svg
      className={`estadio${comGaleria ? ' com-galeria' : ''}`}
      viewBox="0 0 900 400"
      preserveAspectRatio="xMidYMax meet"
      aria-hidden="true"
    >
      <defs>
        {CAMISAS.map((c, i) =>
          c.cores.length === 2 ? (
            <pattern
              key={i}
              id={`${listra}-${i}`}
              width="8"
              height="40"
              patternUnits="userSpaceOnUse"
            >
              <rect width="4" height="40" fill={c.cores[0]} />
              <rect x="4" width="4" height="40" fill={c.cores[1]} />
            </pattern>
          ) : null,
        )}
        <radialGradient id={`${listra}-luz`} cx="50%" cy="0%" r="90%">
          <stop offset="0" stopColor="#3f8a5e" />
          <stop offset="1" stopColor="#1f4a33" />
        </radialGradient>
      </defs>

      {/* gramado maior que a cena: em telas largas ou altas não sobra borda */}
      <rect
        className="gramado"
        x="-2000"
        y="150"
        width="4900"
        height="2000"
        fill={`url(#${listra}-luz)`}
      />
      <g className="linhas">
        <line x1="-2000" y1="150" x2="2900" y2="150" />
        <line x1="300" y1="150" x2="300" y2="2000" />
        <ellipse cx="300" cy="290" rx="70" ry="45" />
        <path d="M900 210 L700 210 L700 380 L900 380" />
        <path d="M900 250 L780 250 L780 340 L900 340" />
      </g>

      {/* gol */}
      <g className="gol">
        <g className="rede">
          {Array.from({ length: 7 }, (_, k) => (
            <line key={`v${k}`} x1={796 + k * 6} y1="222" x2={796 + k * 6} y2="312" />
          ))}
          {Array.from({ length: 8 }, (_, k) => (
            <line key={`h${k}`} x1="796" y1={222 + k * 13} x2="836" y2={222 + k * 13} />
          ))}
        </g>
        <path d="M796 312 L796 222 L836 222" className="trave" />
      </g>

      {[0, 1, 2].map((i) => (
        <Jogador key={i} i={i} listra={listra} foto={fotos[i]} />
      ))}

      <g className="bola">
        <circle r="7" />
        <path d="M-3 -2 L0 -4 L3 -2 L2 2 L-2 2 Z" />
      </g>
      <text x="740" y="190" textAnchor="middle" className="gol-texto">
        GOL!
      </text>
    </svg>
  );
}
