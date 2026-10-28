/**
 * Match Center: o jogo em destaque no topo, sobre a foto do estádio de dados (a mesma do banner
 * "Nova análise").
 * Escudos são GERADOS pelo nome (iniciais + cores derivadas do nome), não são oficiais. Os
 * indicadores de cada time só aparecem quando o dado existe — nada é inventado.
 */
import { useId } from 'react';
import fundoEstadio from '../assets/estadio-dados.webp';
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
      <div
        className="mc-foto"
        style={{ backgroundImage: `url(${fundoEstadio})` }}
        aria-hidden="true"
      />
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
