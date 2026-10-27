/**
 * Match Center: o jogo em destaque no topo, numa cena de estádio à noite.
 * Escudos são GERADOS pelo nome (iniciais + cores derivadas do nome), não são oficiais.
 * Os painéis holográficos dos lados são só ornamento (formas, nenhum número). Os
 * indicadores de cada time só aparecem quando o dado existe — nada é inventado.
 */
import { useId } from 'react';
import type { Derivado } from '../dados';
import type { Rascunho } from '../estado';
import { Icone } from './ui';

const PALETAS: [string, string, string][] = [
  ['#e11d48', '#0b1220', '#ffd23f'],
  ['#1d4ed8', '#f8fafc', '#ffd23f'],
  ['#15803d', '#fde047', '#ffd23f'],
  ['#0f172a', '#f8fafc', '#cbd5e1'],
  ['#7c3aed', '#f8fafc', '#ffd23f'],
  ['#0369a1', '#f8fafc', '#cbd5e1'],
  ['#b91c1c', '#f8fafc', '#ffd23f'],
  ['#1e293b', '#ffd23f', '#ffd23f'],
];

function paleta(nome: string) {
  let h = 0;
  for (const c of nome) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETAS[h % PALETAS.length];
}

function iniciais(nome: string): string {
  const partes = nome
    .replace(/[^\p{L}\s-]/gu, ' ')
    .split(/[\s-]+/)
    .filter((p) => p.length > 1 && !/^(de|da|do|fc|cr|ec|sc|ac)$/i.test(p));
  if (!partes.length) return '?';
  return (
    partes.length === 1
      ? partes[0].slice(0, 3)
      : partes
          .map((p) => p[0])
          .join('')
          .slice(0, 3)
  ).toUpperCase();
}

function Escudo({ nome }: { nome: string }) {
  const [cor, texto, borda] = paleta(nome);
  const id = useId().replace(/:/g, '');
  return (
    <svg className="escudo" viewBox="0 0 120 140" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-b`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff6c2" />
          <stop offset=".45" stopColor={borda} />
          <stop offset="1" stopColor="#8a6400" />
        </linearGradient>
        <linearGradient id={`${id}-f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={cor} />
          <stop offset="1" stopColor="#050a17" />
        </linearGradient>
      </defs>
      <path
        d="M60 4 L112 20 V70 C112 104 88 126 60 136 C32 126 8 104 8 70 V20 Z"
        fill={`url(#${id}-b)`}
      />
      <path
        d="M60 14 L102 27 V70 C102 98 82 116 60 125 C38 116 18 98 18 70 V27 Z"
        fill={`url(#${id}-f)`}
      />
      <path d="M60 14 L102 27 V70 C102 98 82 116 60 125 Z" fill="#fff" opacity=".07" />
      <path d="M48 34 L60 26 L72 34 L68 48 L52 48 Z" fill={texto} opacity=".9" />
      <text x="60" y="92" textAnchor="middle" className="escudo-texto" fill={texto}>
        {iniciais(nome)}
      </text>
    </svg>
  );
}

/** pseudo-aleatório determinístico: a cena fica igual a cada render */
const sorteio = (n: number) => {
  const x = Math.sin(n * 9301 + 49297) * 233280;
  return x - Math.floor(x);
};

function Cena() {
  const id = useId().replace(/:/g, '');
  const u = (s: string) => `url(#${id}-${s})`;
  // campo em perspectiva: topo 650–950 (y 118), base 430–1170 (y 300)
  const xTopo = (k: number) => 650 + (300 * k) / 12;
  const xBase = (k: number) => 430 + (740 * k) / 12;
  const faixas = Array.from({ length: 12 }, (_, k) => ({
    p: `${xTopo(k)},118 ${xTopo(k + 1)},118 ${xBase(k + 1)},300 ${xBase(k)},300`,
    clara: k % 2 === 0,
  }));
  const refletores = [
    { x: 470, y: 70, rot: 14 },
    { x: 560, y: 52, rot: 8 },
    { x: 1040, y: 52, rot: -8 },
    { x: 1130, y: 70, rot: -14 },
  ];
  const particulas = Array.from({ length: 46 }, (_, i) => ({
    x: 380 + sorteio(i) * 840,
    y: 40 + sorteio(i + 50) * 250,
    r: 0.8 + sorteio(i + 90) * 1.6,
    atraso: -(sorteio(i + 130) * 6).toFixed(2),
  }));
  const painel = (x: number, lado: 1 | -1) => (
    <g className="holograma" transform={`translate(${x} 60) skewY(${lado * 6})`}>
      <rect width="150" height="190" rx="10" />
      <line x1="14" y1="30" x2="110" y2="30" />
      <line x1="14" y1="44" x2="80" y2="44" />
      {[0, 1, 2, 3, 4, 5].map((k) => (
        <rect
          key={k}
          x={18 + k * 20}
          y={150 - 14 - k * 9}
          width="10"
          height={14 + k * 9}
          rx="2"
          className="holo-barra"
        />
      ))}
      <circle cx="112" cy="96" r="22" />
      <circle cx="112" cy="96" r="12" />
    </g>
  );
  return (
    <svg
      className="mc-cena"
      viewBox="0 0 1600 320"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`${id}-ceu`} cx="50%" cy="10%" r="80%">
          <stop offset="0" stopColor="#123060" />
          <stop offset=".55" stopColor="#081631" />
          <stop offset="1" stopColor="#050a17" />
        </radialGradient>
        <radialGradient id={`${id}-grama`} cx="50%" cy="45%" r="65%">
          <stop offset="0" stopColor="#3cff8a" />
          <stop offset=".55" stopColor="#14a85a" />
          <stop offset="1" stopColor="#0b5a3a" />
        </radialGradient>
        <linearGradient id={`${id}-feixe`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7fd4ff" stopOpacity=".38" />
          <stop offset="1" stopColor="#7fd4ff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-ouro-e`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffd23f" stopOpacity="0" />
          <stop offset=".6" stopColor="#ffd23f" stopOpacity=".9" />
          <stop offset="1" stopColor="#fff3b0" stopOpacity="1" />
        </linearGradient>
        <linearGradient id={`${id}-ouro-d`} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#ffd23f" stopOpacity="0" />
          <stop offset=".6" stopColor="#ffd23f" stopOpacity=".9" />
          <stop offset="1" stopColor="#fff3b0" stopOpacity="1" />
        </linearGradient>
        <linearGradient id={`${id}-varre`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#c8fff6" stopOpacity="0" />
          <stop offset=".5" stopColor="#c8fff6" stopOpacity=".4" />
          <stop offset="1" stopColor="#c8fff6" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-bola`} cx="35%" cy="30%" r="70%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".6" stopColor="#bfe9ff" />
          <stop offset="1" stopColor="#2a7bd6" />
        </radialGradient>
        <clipPath id={`${id}-campo`}>
          <polygon points="650,118 950,118 1170,300 430,300" />
        </clipPath>
        <filter id={`${id}-brilho`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect width="1600" height="320" fill={u('ceu')} />

      {/* arquibancada: fileiras de luz */}
      <g className="arquibancada">
        {Array.from({ length: 5 }, (_, linha) => (
          <path
            key={linha}
            d={`M${300 - linha * 30} ${150 - linha * 22} Q800 ${70 - linha * 26} ${1300 + linha * 30} ${150 - linha * 22}`}
            className={`fileira fileira-${linha % 2}`}
          />
        ))}
      </g>

      {/* refletores e feixes */}
      {refletores.map((f, i) => (
        <g key={i} transform={`rotate(${f.rot} ${f.x} ${f.y})`}>
          <polygon
            points={`${f.x - 22},${f.y} ${f.x + 22},${f.y} ${f.x + 140},${f.y + 260} ${f.x - 140},${f.y + 260}`}
            fill={u('feixe')}
            className="feixe-mc"
            style={{ animationDelay: `${-i * 1.3}s` }}
          />
          <rect x={f.x - 26} y={f.y - 10} width="52" height="12" rx="3" className="lampada-mc" />
          {[0, 1, 2, 3, 4].map((k) => (
            <rect
              key={k}
              x={f.x - 22 + k * 9.5}
              y={f.y - 8}
              width="6"
              height="8"
              rx="1"
              fill="#e9fbff"
            />
          ))}
        </g>
      ))}

      {painel(40, 1)}
      {painel(1410, -1)}

      {/* rastros de luz amarela */}
      <g filter={u('brilho')}>
        <path d="M-20 300 L560 238" stroke={u('ouro-e')} strokeWidth="4" className="rastro" />
        <path d="M-20 318 L470 270" stroke={u('ouro-e')} strokeWidth="2" opacity=".6" />
        <path d="M1620 300 L1040 238" stroke={u('ouro-d')} strokeWidth="4" className="rastro" />
        <path d="M1620 318 L1130 270" stroke={u('ouro-d')} strokeWidth="2" opacity=".6" />
      </g>

      {/* campo */}
      <ellipse cx="800" cy="215" rx="470" ry="120" className="aura-mc" />
      <g clipPath={u('campo')}>
        {faixas.map((f, k) => (
          <polygon key={k} points={f.p} fill={f.clara ? '#18b864' : '#119a52'} />
        ))}
        <polygon points="650,118 950,118 1170,300 430,300" fill={u('grama')} opacity=".55" />
        <rect x="300" y="110" width="260" height="200" fill={u('varre')} className="varre-mc" />
      </g>
      <g className="linhas-mc" filter={u('brilho')}>
        <polygon points="650,118 950,118 1170,300 430,300" />
        <line x1="800" y1="118" x2="800" y2="300" />
        <ellipse cx="800" cy="200" rx="88" ry="28" />
        <polygon points="560,190 640,190 625,140 590,140" />
        <polygon points="1040,190 960,190 975,140 1010,140" />
        <polygon points="470,268 610,268 585,215 510,215" />
        <polygon points="1130,268 990,268 1015,215 1090,215" />
      </g>
      {particulas.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={p.r}
          className="particula"
          style={{ animationDelay: `${p.atraso}s` }}
        />
      ))}
      <g filter={u('brilho')}>
        <circle cx="800" cy="196" r="22" className="pulso" />
        <circle cx="800" cy="196" r="12" fill={u('bola')} />
        <path d="M796 192 L800 189 L804 192 L802.5 197 L797.5 197 Z" fill="#0b2a55" />
      </g>
    </svg>
  );
}

function indicadores(d: Derivado, t: 'casa' | 'fora'): string[] {
  const s = (t === 'casa' ? d.modeloCasa : d.modeloFora).stats;
  const l = d.lambda?.lambdas[t];
  const f = (x: number) => x.toFixed(2).replace('.', ',');
  const out: string[] = [];
  if (l !== undefined) out.push(`λ ${f(l)}`);
  if (s?.xg !== undefined) out.push(`xG ${f(s.xg)}`);
  if (s) out.push(`MARCA ${f(s.golsPro)}`, `SOFRE ${f(s.golsContra)}`);
  out.push(t === 'casa' ? 'CASA' : 'FORA');
  return out;
}

export function MatchCenter({ r, d }: { r: Rascunho; d: Derivado }) {
  const casa = r.jogo.casa || 'Mandante';
  const fora = r.jogo.fora || 'Visitante';
  const [ano, mes, dia] = r.jogo.data ? r.jogo.data.split('-') : [];
  const MESES = [
    'JAN',
    'FEV',
    'MAR',
    'ABR',
    'MAI',
    'JUN',
    'JUL',
    'AGO',
    'SET',
    'OUT',
    'NOV',
    'DEZ',
  ];
  const data = ano ? `${dia} ${MESES[Number(mes) - 1]} ${ano}` : '';
  const lado = (t: 'casa' | 'fora', nome: string) => (
    <div className={`mc-time mc-${t}`}>
      <Escudo nome={nome} />
      <div className="mc-texto">
        <div className="mc-nome">{nome}</div>
        <div className="mc-indicadores">{indicadores(d, t).join(' | ')}</div>
      </div>
    </div>
  );
  return (
    <section className="match-center" aria-label={`${casa} contra ${fora}`}>
      <Cena />
      <div className="mc-conteudo">
        {lado('casa', casa)}
        <div className="mc-centro">
          <div className="mc-meta">
            <Icone nome="trofeu" tamanho={18} />
            <span>{r.jogo.competicao || 'Competição'}</span>
            {data && <span>• {data}</span>}
            {r.jogo.hora && <span>• {r.jogo.hora}</span>}
          </div>
          <div className="mc-vs">VS</div>
        </div>
        {lado('fora', fora)}
      </div>
    </section>
  );
}
