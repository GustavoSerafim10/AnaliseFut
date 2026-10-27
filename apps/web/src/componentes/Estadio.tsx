import { useEffect, useId, useState, type CSSProperties } from 'react';
import { CAMISAS } from './Trio';

/**
 * Fundo animado: estádio à noite e o lance em loop (10 s).
 * 10 canarinho conduz e toca → 11 do Barça dá um chapéu no zagueiro e rola → 10 da Argentina
 * avança e bate no ângulo; goleiro vai no outro canto, rede estufa, flashes, confete, GOLAÇO.
 * Só jogadores estilizados (nenhum rosto real); com figurinhas, o rosto vira a foto escolhida
 * no aparelho. Tudo em CSS (estilos.css, seção "estádio"); para com reduzir movimento.
 */

/** pseudo-aleatório determinístico: a torcida fica igual a cada render */
const sorteio = (n: number) => {
  const x = Math.sin(n * 9301 + 49297) * 233280;
  return x - Math.floor(x);
};

interface Kit {
  camisa: string;
  listra?: string;
  gola: string;
  numero: string;
  corNumero: string;
  calcao: string;
  meia: string;
  chuteira: string;
  pele: string;
  cabelo: string;
}

const KITS: Kit[] = [
  {
    camisa: CAMISAS[0].cores[0],
    gola: CAMISAS[0].gola,
    numero: CAMISAS[0].numero,
    corNumero: CAMISAS[0].corNumero,
    calcao: '#1f47b8',
    meia: '#f4f6fb',
    chuteira: '#ffd60a',
    pele: '#7a4a2e',
    cabelo: '#1b120c',
  },
  {
    camisa: CAMISAS[1].cores[0],
    listra: CAMISAS[1].cores[1],
    gola: CAMISAS[1].gola,
    numero: CAMISAS[1].numero,
    corNumero: CAMISAS[1].corNumero,
    calcao: '#0b2b6b',
    meia: '#a50044',
    chuteira: '#ff6b1a',
    pele: '#9a6440',
    cabelo: '#e9c46a',
  },
  {
    camisa: CAMISAS[2].cores[0],
    listra: CAMISAS[2].cores[1],
    gola: CAMISAS[2].gola,
    numero: CAMISAS[2].numero,
    corNumero: CAMISAS[2].corNumero,
    calcao: '#111827',
    meia: '#f4f6fb',
    chuteira: '#2ee6c8',
    pele: '#c08a64',
    cabelo: '#3b2414',
  },
];

const GOLEIRO: Kit = {
  camisa: '#2bd47a',
  gola: '#0e5a34',
  numero: '1',
  corNumero: '#0e5a34',
  calcao: '#0e5a34',
  meia: '#2bd47a',
  chuteira: '#111',
  pele: '#b07a52',
  cabelo: '#2a1a10',
};
const ZAGUEIRO: Kit = {
  camisa: '#3a4255',
  gola: '#cfd6e6',
  numero: '4',
  corNumero: '#cfd6e6',
  calcao: '#2a3142',
  meia: '#3a4255',
  chuteira: '#cfd6e6',
  pele: '#8a5a3c',
  cabelo: '#15100c',
};

function Boneco({
  kit,
  idListra,
  foto,
  idRosto,
  correndo = true,
}: {
  kit: Kit;
  idListra?: string;
  foto?: string | null;
  idRosto: string;
  correndo?: boolean;
}) {
  const perna = (classe: string) => (
    <g className={`perna ${correndo ? classe : ''}`}>
      <rect x="-5" y="-48" width="10" height="28" rx="4" fill={kit.pele} />
      <rect x="-5.5" y="-24" width="11" height="20" rx="3" fill={kit.meia} />
      <ellipse cx="4" cy="-3" rx="9" ry="4.5" fill={kit.chuteira} />
    </g>
  );
  const braco = (lado: 1 | -1, classe: string) => (
    <g className={`braco ${correndo ? classe : ''}`}>
      <rect x={16 * lado - 5} y="-99" width="10" height="16" rx="4" fill={kit.camisa} />
      <rect x={16 * lado - 4} y="-85" width="8" height="22" rx="4" fill={kit.pele} />
    </g>
  );
  return (
    <g>
      <ellipse cx="2" cy="1" rx="24" ry="5.5" className="sombra-chao" />
      {braco(-1, 'balanca-b')}
      {perna('balanca-a')}
      {perna('balanca-b')}
      <rect x="-14" y="-60" width="28" height="17" rx="4" fill={kit.calcao} />
      <path
        d="M-17 -101 Q0 -93 17 -101 L19 -57 L-19 -57 Z"
        fill={idListra ? `url(#${idListra})` : kit.camisa}
        stroke={kit.gola}
        strokeWidth="1.5"
      />
      <path d="M-7 -100 Q0 -95 7 -100" fill="none" stroke={kit.gola} strokeWidth="3" />
      <text x="0" y="-66" textAnchor="middle" className="numero" fill={kit.corNumero}>
        {kit.numero}
      </text>
      {braco(1, 'balanca-a')}
      <rect x="-4" y="-108" width="8" height="9" fill={kit.pele} />
      {foto ? (
        <>
          <clipPath id={idRosto}>
            <circle cx="0" cy="-118" r="15" />
          </clipPath>
          <image
            href={foto}
            x="-15"
            y="-133"
            width="30"
            height="30"
            clipPath={`url(#${idRosto})`}
            preserveAspectRatio="xMidYMid slice"
          />
          <circle cx="0" cy="-118" r="15" fill="none" stroke={kit.gola} strokeWidth="2" />
        </>
      ) : (
        <>
          <circle cx="0" cy="-116" r="12" fill={kit.pele} />
          <path
            d="M-12 -118 Q-11 -131 0 -131 Q11 -131 12 -118 Q6 -124 0 -123 Q-6 -124 -12 -118 Z"
            fill={kit.cabelo}
          />
        </>
      )}
    </g>
  );
}

/** retrato = cena inteira embaixo; paisagem = cena preenche a tela */
function useRetrato() {
  const ler = () => typeof window !== 'undefined' && window.innerHeight > window.innerWidth;
  const [retrato, setRetrato] = useState(ler);
  useEffect(() => {
    const f = () => setRetrato(ler());
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return retrato;
}

const CORES_CONFETE = ['#ffd60a', '#009c3b', '#a50044', '#004d98', '#75aadb', '#ffffff'];
const LED =
  'PRICING ENGINE  ★  NO BET É O PADRÃO  ★  R10 · NEY · MESSI  ★  SÓ ENTRA QUANDO O PREÇO PAGA  ★  ';

/** `fotos`: figurinhas escolhidas no aparelho (só locais); sem foto, cabeça estilizada. */
export function Estadio({
  fotos = [],
  comGaleria = false,
}: {
  fotos?: (string | null)[];
  /** com fotos de fundo, o céu e a arquibancada ficam translúcidos para elas aparecerem */
  comGaleria?: boolean;
}) {
  const uid = useId().replace(/:/g, '');
  const retrato = useRetrato();
  const id = (s: string) => `${uid}-${s}`;

  // torcida: flashes de celular espalhados pela arquibancada
  const flashes = Array.from({ length: 70 }, (_, i) => ({
    x: -200 + sorteio(i) * 2000,
    y: 215 + sorteio(i + 100) * 200,
    atraso: -(sorteio(i + 200) * 10).toFixed(2),
    gol: i % 2 === 0,
  }));
  // chuva de confete: cai do alto sobre o campo, nas cores das três camisas
  const confete = Array.from({ length: 60 }, (_, i) => ({
    cor: CORES_CONFETE[i % CORES_CONFETE.length],
    x: Math.round(380 + sorteio(i + 600) * 1220),
    y: Math.round(-40 + sorteio(i + 700) * 160),
    dx: `${Math.round((sorteio(i + 300) - 0.5) * 160)}px`,
    dy: `${Math.round(330 + sorteio(i + 400) * 380)}px`,
    r: `${Math.round((sorteio(i + 500) - 0.5) * 1440)}deg`,
  }));
  // faixas do gramado ficam mais altas perto da câmera (perspectiva)
  const faixas = Array.from({ length: 16 }, (_, i) => {
    const y0 = 452 + 16 * i + 2.4 * i * i;
    const y1 = 452 + 16 * (i + 1) + 2.4 * (i + 1) * (i + 1);
    return { y: y0, h: y1 - y0, clara: i % 2 === 0 };
  });

  return (
    <svg
      className={`estadio${comGaleria ? ' com-galeria' : ''}`}
      viewBox="0 0 1600 900"
      preserveAspectRatio={retrato ? 'xMidYMax meet' : 'xMidYMid slice'}
      aria-hidden="true"
    >
      <defs>
        {KITS.map((k, i) =>
          k.listra ? (
            <pattern
              key={i}
              id={id(`listra${i}`)}
              width="10"
              height="60"
              patternUnits="userSpaceOnUse"
            >
              <rect width="5" height="60" fill={k.camisa} />
              <rect x="5" width="5" height="60" fill={k.listra} />
            </pattern>
          ) : null,
        )}
        <linearGradient id={id('ceu')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a2550" />
          <stop offset="1" stopColor="#2c3a6b" />
        </linearGradient>
        <linearGradient id={id('arquibancada')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#141b33" />
          <stop offset="1" stopColor="#262f52" />
        </linearGradient>
        <pattern id={id('torcida')} width="14" height="12" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="4" r="2.6" fill="#a50044" opacity=".45" />
          <circle cx="10" cy="3" r="2.6" fill="#ffd60a" opacity=".35" />
          <circle cx="6.5" cy="9.5" r="2.6" fill="#75aadb" opacity=".35" />
          <circle cx="13" cy="9" r="2.4" fill="#e5e7eb" opacity=".25" />
        </pattern>
        <linearGradient id={id('feixe')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff8dc" stopOpacity=".55" />
          <stop offset="1" stopColor="#fff8dc" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={id('vinheta')} cx="50%" cy="55%" r="75%">
          <stop offset=".6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".55" />
        </radialGradient>
        <linearGradient id={id('ouro')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3a8" />
          <stop offset=".5" stopColor="#ffd60a" />
          <stop offset="1" stopColor="#e08a00" />
        </linearGradient>
        <clipPath id={id('placa')}>
          <rect x="-400" y="428" width="2400" height="24" />
        </clipPath>
      </defs>

      {/* céu e arquibancada (maiores que a cena: em qualquer tela não sobra borda) */}
      <g className="fundo-estadio">
        <rect x="-1200" y="-1200" width="4000" height="1700" fill={`url(#${id('ceu')})`} />
        <path
          d="M-1200 200 L2800 200 L2800 430 L-1200 430 Z"
          fill={`url(#${id('arquibancada')})`}
        />
        <rect x="-1200" y="205" width="4000" height="222" fill={`url(#${id('torcida')})`} />
        <path d="M-1200 200 L2800 200" stroke="#3b4a7a" strokeWidth="4" />
        {flashes.map((f, i) => (
          <circle
            key={i}
            cx={f.x}
            cy={f.y}
            r="3"
            className={f.gol ? 'flash flash-gol' : 'flash'}
            style={{ animationDelay: f.gol ? undefined : `${f.atraso}s` }}
          />
        ))}
      </g>

      {/* refletores */}
      {[
        [-60, -1],
        [300, -1],
        [1300, 1],
        [1660, 1],
      ].map(([x, lado], i) => (
        <g key={i} className="refletor" style={{ animationDelay: `${-i * 1.7}s` }}>
          <polygon
            points={`${x - 30},70 ${x + 30},70 ${x + 30 - lado * 520},900 ${x - 30 - lado * 260},900`}
            fill={`url(#${id('feixe')})`}
            className="feixe"
          />
          <line x1={x} y1="70" x2={x} y2="210" stroke="#3b4a7a" strokeWidth="6" />
          <rect
            x={x - 34}
            y="44"
            width="68"
            height="28"
            rx="4"
            fill="#fffbe6"
            className="lampadas"
          />
        </g>
      ))}

      {/* placa de LED na beira do campo */}
      <rect x="-400" y="428" width="2400" height="24" fill="#0a0f22" />
      <g clipPath={`url(#${id('placa')})`}>
        <g className="led">
          {[0, 1, 2].map((k) => (
            <text key={k} x={-400 + k * 1400} y="446" className="led-texto">
              {LED}
            </text>
          ))}
        </g>
      </g>

      {/* gramado em perspectiva */}
      <g className="gramado">
        {faixas.map((f, i) => (
          <rect
            key={i}
            x="-1200"
            y={f.y}
            width="4000"
            height={f.h + 1}
            fill={f.clara ? '#34845a' : '#2d7550'}
          />
        ))}
        <rect x="-1200" y={faixas[15].y + faixas[15].h} width="4000" height="2000" fill="#2d7550" />
      </g>
      <g className="linhas">
        <line x1="-1200" y1="456" x2="2800" y2="456" />
        <line x1="800" y1="456" x2="800" y2="1400" />
        <ellipse cx="800" cy="640" rx="190" ry="58" />
        <circle cx="800" cy="640" r="4" fill="rgba(255,255,255,.5)" />
        <path d="M1600 470 L1330 470 L1270 760 L1600 760" />
        <path d="M1600 490 L1450 490 L1430 600 L1600 600" />
      </g>

      {/* gol */}
      <g className="gol">
        <g className="rede">
          {Array.from({ length: 12 }, (_, k) => (
            <line key={`v${k}`} x1={1478 + k * 8} y1="458" x2={1490 + k * 8} y2="566" />
          ))}
          {Array.from({ length: 9 }, (_, k) => (
            <line key={`h${k}`} x1="1478" y1={458 + k * 13} x2="1580" y2={460 + k * 13} />
          ))}
        </g>
        <path d="M1478 566 L1478 456 L1580 456 L1580 566" className="trave" />
      </g>

      {/* o lance */}
      <g className="lance">
        <g className="ator goleiro">
          <g className="mergulho">
            <g transform="scale(0.92)">
              <Boneco kit={GOLEIRO} idRosto={id('r-g')} correndo={false} />
            </g>
          </g>
        </g>
        <g className="ator zagueiro">
          <g className="carrinho">
            <g transform="scale(0.95)">
              <Boneco kit={ZAGUEIRO} idRosto={id('r-z')} />
            </g>
          </g>
        </g>
        {KITS.map((k, i) => (
          <g key={i} className={`ator jogador-${i}`}>
            <g className={i === 2 ? 'comemora' : undefined}>
              <g transform={`scale(${[1.15, 1, 1.08][i]})`}>
                <Boneco
                  kit={k}
                  idListra={k.listra ? id(`listra${i}`) : undefined}
                  foto={fotos[i]}
                  idRosto={id(`r${i}`)}
                />
              </g>
            </g>
          </g>
        ))}

        <g className="bola-chao">
          <ellipse rx="11" ry="3.5" className="sombra-bola" />
          <g className="bola-altura">
            <g className="quique">
              <circle r="9" className="bola" />
              <g className="gomos">
                <path d="M-4 -3 L0 -6 L4 -3 L2.5 2 L-2.5 2 Z" />
                <path d="M-9 1 L-6 -1 M9 1 L6 -1 M0 6 L0 9" stroke="#1b2333" strokeWidth="1.5" />
              </g>
            </g>
          </g>
        </g>
      </g>

      {/* comemoração */}
      <g className="festa">
        {confete.map((c, i) => (
          <rect
            key={i}
            x={c.x}
            y={c.y}
            width="16"
            height="9"
            rx="2"
            fill={c.cor}
            className="confete"
            style={{ '--dx': c.dx, '--dy': c.dy, '--r': c.r } as CSSProperties}
          />
        ))}
        <text x="800" y="330" textAnchor="middle" className="golaco" fill={`url(#${id('ouro')})`}>
          GOLAÇO!
        </text>
      </g>

      <rect x="-1200" y="-1200" width="4000" height="3300" fill={`url(#${id('vinheta')})`} />
    </svg>
  );
}
