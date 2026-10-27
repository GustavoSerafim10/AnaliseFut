/**
 * Match Center: o jogo em destaque no topo. Escudos são GERADOS pelo nome (iniciais + cores
 * derivadas do nome), não são escudos oficiais. Indicadores de cada time só aparecem quando o
 * dado existe nas estatísticas consolidadas — nada é inventado para preencher.
 */
import { useId } from 'react';
import type { Derivado } from '../dados';
import type { Rascunho } from '../estado';
import { Icone } from './ui';

const PALETAS: [string, string][] = [
  ['#e11d48', '#0b1220'],
  ['#2563eb', '#f8fafc'],
  ['#16a34a', '#fde047'],
  ['#f59e0b', '#111827'],
  ['#7c3aed', '#f8fafc'],
  ['#0ea5e9', '#0b1220'],
  ['#dc2626', '#f8fafc'],
  ['#111827', '#f8fafc'],
];

function paleta(nome: string): [string, string] {
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
  const [cor, texto] = paleta(nome);
  const id = useId().replace(/:/g, '');
  return (
    <svg className="escudo" viewBox="0 0 100 116" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-b`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe27a" />
          <stop offset="1" stopColor="#b98900" />
        </linearGradient>
        <linearGradient id={`${id}-f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={cor} />
          <stop offset="1" stopColor={cor} stopOpacity=".72" />
        </linearGradient>
      </defs>
      <path
        d="M50 4 L92 18 V58 C92 86 72 104 50 112 C28 104 8 86 8 58 V18 Z"
        fill={`url(#${id}-f)`}
        stroke={`url(#${id}-b)`}
        strokeWidth="5"
      />
      <path d="M50 14 L82 25 V58 C82 80 67 94 50 101 Z" fill="#fff" opacity=".08" />
      <text x="50" y="70" textAnchor="middle" className="escudo-texto" fill={texto}>
        {iniciais(nome)}
      </text>
    </svg>
  );
}

function Campo() {
  const id = useId().replace(/:/g, '');
  // faixas do gramado em perspectiva (mais largas perto da câmera)
  const y = (k: number) => 40 + 200 * (k / 10) ** 1.15;
  const x = (yy: number, lado: -1 | 1) => 400 + lado * (180 + ((yy - 40) / 200) * 270);
  const faixas = Array.from({ length: 10 }, (_, k) => {
    const y0 = y(k);
    const y1 = y(k + 1);
    return `${x(y0, -1)},${y0} ${x(y0, 1)},${y0} ${x(y1, 1)},${y1} ${x(y1, -1)},${y1}`;
  });
  const particulas = Array.from({ length: 16 }, (_, i) => ({
    cx: 160 + ((i * 97) % 480),
    cy: 60 + ((i * 53) % 170),
    atraso: -((i * 0.7) % 6),
  }));
  return (
    <svg className="campo" viewBox="0 0 800 260" aria-hidden="true">
      <defs>
        <clipPath id={`${id}-c`}>
          <polygon points="220,40 580,40 670,240 130,240" />
        </clipPath>
        <linearGradient id={`${id}-varre`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7ff7ff" stopOpacity="0" />
          <stop offset=".5" stopColor="#7ff7ff" stopOpacity=".35" />
          <stop offset="1" stopColor="#7ff7ff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-luz`} cx="50%" cy="55%" r="60%">
          <stop offset="0" stopColor="#3cff9a" stopOpacity=".35" />
          <stop offset="1" stopColor="#3cff9a" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-brilho`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <ellipse
        cx="400"
        cy="150"
        rx="380"
        ry="120"
        fill={`url(#${id}-luz)`}
        className="campo-aura"
      />
      <g clipPath={`url(#${id}-c)`}>
        {faixas.map((p, k) => (
          <polygon key={k} points={p} fill={k % 2 ? '#0d5a37' : '#0f6a40'} />
        ))}
        <rect
          x="-200"
          y="30"
          width="220"
          height="220"
          fill={`url(#${id}-varre)`}
          className="campo-varredura"
        />
      </g>
      <g className="campo-linhas" filter={`url(#${id}-brilho)`}>
        <polygon points="220,40 580,40 670,240 130,240" />
        <line x1="400" y1="40" x2="400" y2="240" />
        <ellipse cx="400" cy="132" rx="62" ry="24" />
        <polygon points="160,175 238,175 228,120 180,120" />
        <polygon points="640,175 562,175 572,120 620,120" />
      </g>
      {particulas.map((p, i) => (
        <circle
          key={i}
          cx={p.cx}
          cy={p.cy}
          r="1.6"
          className="particula"
          style={{ animationDelay: `${p.atraso}s` }}
        />
      ))}
      <g className="bola-central">
        <circle cx="400" cy="132" r="14" className="pulso" />
        <circle cx="400" cy="132" r="7.5" fill="#f8fafc" />
        <path d="M397 129.5 L400 127.5 L403 129.5 L402 133 L398 133 Z" fill="#0b1220" />
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
  if (s) out.push(`marca ${f(s.golsPro)}`, `sofre ${f(s.golsContra)}`);
  return out;
}

export function MatchCenter({ r, d }: { r: Rascunho; d: Derivado }) {
  const casa = r.jogo.casa || 'Mandante';
  const fora = r.jogo.fora || 'Visitante';
  const data = r.jogo.data ? r.jogo.data.split('-').reverse().join('/') : '';
  const lado = (t: 'casa' | 'fora', nome: string, papel: string) => (
    <div className={`mc-time mc-${t}`}>
      <Escudo nome={nome} />
      <div>
        <div className="mc-papel">{papel}</div>
        <div className="mc-nome">{nome}</div>
        <div className="mc-indicadores">
          {indicadores(d, t).map((x) => (
            <span key={x}>{x}</span>
          ))}
        </div>
      </div>
    </div>
  );
  return (
    <section className="match-center" aria-label={`${casa} contra ${fora}`}>
      {lado('casa', casa, 'Mandante')}
      <div className="mc-centro">
        <div className="mc-meta">
          <Icone nome="trofeu" tamanho={15} />
          <span>{r.jogo.competicao || 'Competição'}</span>
          {data && <span>• {data}</span>}
          {r.jogo.hora && <span>• {r.jogo.hora}</span>}
        </div>
        <div className="mc-vs">VS</div>
        <Campo />
      </div>
      {lado('fora', fora, 'Visitante')}
    </section>
  );
}
