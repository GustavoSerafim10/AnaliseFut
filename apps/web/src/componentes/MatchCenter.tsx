/**
 * Match Center: o jogo em destaque no topo, sobre a foto do estádio de dados (a mesma do banner
 * "Nova análise"), tingido com as cores dos dois times (ver coresTimes.ts).
 * Os escudos são desenhados com as cores e as iniciais do time, não são oficiais. Os indicadores
 * de cada time só aparecem quando o dado existe — nada é inventado.
 */
import { useId, type CSSProperties } from 'react';
import fundoEstadio from '../assets/estadio-dados.webp';
import {
  corDeBrilho,
  corDoTexto,
  coresDoTime,
  escudoDoTime,
  misturar,
  salvarCores,
  salvarEscudo,
  useCoresEscolhidas,
  type CoresTime,
} from '../coresTimes';
import type { Derivado } from '../dados';
import type { Rascunho } from '../estado';
import { Icone } from './ui';

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

const FORA_DO_ESCUDO = 'M60 4 L112 20 V70 C112 104 88 126 60 136 C32 126 8 104 8 70 V20 Z';
const DENTRO_DO_ESCUDO = 'M60 14 L102 27 V70 C102 98 82 116 60 125 C38 116 18 98 18 70 V27 Z';

function Escudo({ nome, cores }: { nome: string; cores: CoresTime }) {
  const id = useId().replace(/:/g, '');
  const brilho = corDeBrilho(cores);
  const texto = corDoTexto(cores);
  return (
    <svg className="escudo" viewBox="0 0 120 140" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-b`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={misturar(brilho, '#ffffff', 0.55)} />
          <stop offset=".5" stopColor={brilho} />
          <stop offset="1" stopColor={misturar(brilho, '#000000', 0.55)} />
        </linearGradient>
        <linearGradient id={`${id}-s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".16" />
          <stop offset=".55" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".38" />
        </linearGradient>
        <clipPath id={`${id}-c`}>
          <path d={DENTRO_DO_ESCUDO} />
        </clipPath>
      </defs>
      <path d={FORA_DO_ESCUDO} fill={`url(#${id}-b)`} />
      <g clipPath={`url(#${id}-c)`}>
        <rect width="120" height="140" fill={cores.cor1} />
        {cores.padrao === 'listras' &&
          [30, 54, 78].map((x) => <rect key={x} x={x} width="12" height="140" fill={cores.cor2} />)}
        {cores.padrao === 'faixa' && (
          <path d="M0 26 L26 0 L120 94 L120 122 L94 122 Z" fill={cores.cor2} />
        )}
        <rect width="120" height="140" fill={`url(#${id}-s)`} />
        <rect className="escudo-reflexo" x="-70" width="34" height="140" fill="#fff" />
      </g>
      <text
        x="60"
        y="84"
        textAnchor="middle"
        className="escudo-texto"
        fill={cores.padrao === 'liso' ? texto : '#f8fafc'}
        stroke={cores.padrao === 'liso' ? 'none' : '#0b0b0d'}
      >
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

const ORIGEM: Record<CoresTime['origem'], string> = {
  manual: 'escolhidas por você',
  tabela: 'da tabela de clubes',
  print: 'lidas da camisa no print',
  escudo: 'lidas do escudo no print',
  neutra: 'time não reconhecido: cole o print do jogo ou escolha as cores',
};

/** Trocar as cores do time; a escolha fica salva e vale nos próximos jogos dele. */
function EscolherCores({ nome, cores }: { nome: string; cores: CoresTime }) {
  const mudar = (campo: 'cor1' | 'cor2', valor: string) => {
    salvarCores(nome, { cor1: cores.cor1, cor2: cores.cor2, [campo]: valor });
  };
  return (
    <details className={`mc-cores${cores.origem === 'neutra' ? ' pendente' : ''}`}>
      <summary title={`Cores ${ORIGEM[cores.origem]}`}>
        {cores.origem === 'neutra' ? 'Escolher cores' : 'Cores'}
      </summary>
      <div className="mc-cores-painel">
        <small>{ORIGEM[cores.origem]}</small>
        <label>
          Principal
          <input type="color" value={cores.cor1} onChange={(e) => mudar('cor1', e.target.value)} />
        </label>
        <label>
          Secundária
          <input type="color" value={cores.cor2} onChange={(e) => mudar('cor2', e.target.value)} />
        </label>
        {escudoDoTime(nome) && (
          <button type="button" onClick={() => salvarEscudo(nome, null)}>
            Remover escudo
          </button>
        )}
        {cores.origem === 'manual' && (
          <button type="button" onClick={() => salvarCores(nome, null)}>
            Voltar ao automático
          </button>
        )}
      </div>
    </details>
  );
}

const FAISCAS = Array.from({ length: 7 }, (_, i) => i);

export function MatchCenter({ r, d }: { r: Rascunho; d: Derivado }) {
  useCoresEscolhidas();
  const casa = r.jogo.casa || 'Mandante';
  const fora = r.jogo.fora || 'Visitante';
  const coresCasa = coresDoTime(casa, d.escalacao.casa.cores);
  const coresFora = coresDoTime(fora, d.escalacao.fora.cores);
  const brilhoCasa = corDeBrilho(coresCasa);
  const brilhoFora = corDeBrilho(coresFora);
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
  const lado = (t: 'casa' | 'fora', nome: string, cores: CoresTime, brilho: string) => (
    <div className={`mc-time mc-${t}`} style={{ '--time': brilho } as CSSProperties}>
      <div className="mc-escudo">
        <span className="mc-onda" aria-hidden="true" />
        <span className="mc-onda dois" aria-hidden="true" />
        {escudoDoTime(nome) ? (
          <img className="escudo escudo-real" src={escudoDoTime(nome)!.imagem} alt="" />
        ) : (
          <Escudo nome={nome} cores={cores} />
        )}
      </div>
      <div className="mc-texto">
        <div className="mc-nome">{nome}</div>
        <div className="mc-indicadores">{indicadores(d, t).join(' | ')}</div>
        <EscolherCores nome={nome} cores={cores} />
      </div>
    </div>
  );
  return (
    <section
      className="match-center"
      aria-label={`${casa} contra ${fora}`}
      style={{ '--casa': brilhoCasa, '--fora': brilhoFora } as CSSProperties}
    >
      <div
        className="mc-foto"
        style={{ backgroundImage: `url(${fundoEstadio})` }}
        aria-hidden="true"
      />
      <div className="mc-luz casa" aria-hidden="true" />
      <div className="mc-luz fora" aria-hidden="true" />
      <div className="mc-feixe casa" aria-hidden="true" />
      <div className="mc-feixe fora" aria-hidden="true" />
      <div className="mc-faiscas" aria-hidden="true">
        {FAISCAS.map((i) => (
          <i key={`c${i}`} className="casa" />
        ))}
        {FAISCAS.map((i) => (
          <i key={`f${i}`} className="fora" />
        ))}
      </div>
      <div className="mc-conteudo">
        {lado('casa', casa, coresCasa, brilhoCasa)}
        <div className="mc-centro">
          <div className="mc-meta">
            {r.jogo.competicao && <Icone nome="trofeu" tamanho={18} />}
            <span>{[r.jogo.competicao, data, r.jogo.hora].filter(Boolean).join(' • ')}</span>
          </div>
          <div className="mc-vs">
            <span className="mc-vs-anel" aria-hidden="true" />
            <span className="mc-vs-texto">VS</span>
          </div>
        </div>
        {lado('fora', fora, coresFora, brilhoFora)}
      </div>
      <div className="mc-fita" aria-hidden="true" />
    </section>
  );
}
