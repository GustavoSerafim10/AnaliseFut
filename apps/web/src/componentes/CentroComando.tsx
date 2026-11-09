/**
 * Centro de comando do Histórico: as duas camadas (Melhores entradas e BET), cada uma com os seus
 * números. Todo valor sai das apostas apuradas; sem dado, o painel diz que falta dado.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  COLUNAS_ODD,
  itensBet,
  itensMelhores,
  mapaDeCalor,
  prometidoPorFaixa,
  resumirCamada,
  type Camada,
  type ItemCamada,
  type LinhaCalor,
  type LinhaPrometido,
  type PontoCamada,
  type RecorteBet,
  type RecorteMelhores,
  type ResumoCamada,
} from '../camadas';
import {
  JOGOS_PARA_CONFIAR,
  placarAcerto,
  type EntradaHistorico,
  type Situacao,
} from '../historico';
import { PlacarDeAcerto } from './PainelHistorico';
import { Icone, type NomeIcone } from './ui';

const n2 = (x: number) => x.toFixed(2).replace('.', ',');
const p1 = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
const sinal = (x: number, f: (v: number) => string) =>
  `${x > 0 ? '+' : x < 0 ? '−' : ''}${f(Math.abs(x))}`;
const dataBr = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/');
const METAS_CLV = 100;

const RECORTES_MELHORES: { id: RecorteMelhores; nome: string; dica: string }[] = [
  {
    id: 'primeira',
    nome: '1ª de cada jogo',
    dica: 'A amostra limpa: só a principal sugestão de cada jogo, na odd sugerida, tendo você apostado ou não.',
  },
  {
    id: 'todas',
    nome: 'Toda a lista',
    dica: 'Todas as sugestões de cada jogo. Apostas do mesmo jogo andam juntas, então o acerto daqui engana mais.',
  },
  {
    id: 'entrei',
    nome: 'Só onde entrei',
    dica: 'Só as sugestões que você apostou, na odd que pegou.',
  },
];
const RECORTES_BET: { id: RecorteBet; nome: string; dica: string }[] = [
  {
    id: 'todas',
    nome: 'Todos os BET',
    dica: 'Toda decisão BET da análise técnica, tendo você entrado ou não.',
  },
  { id: 'entrei', nome: 'Só onde entrei', dica: 'Só os BET que você apostou, na odd que pegou.' },
];

function useLargura(inicial: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(inicial);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(([x]) => setLargura(Math.round(x.contentRect.width)));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, largura] as const;
}

export function Painel({
  titulo,
  icone,
  extra,
  className = '',
  children,
}: {
  titulo: string;
  icone: NomeIcone;
  extra?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`cc-painel ${className}`}>
      <header className="cc-painel-topo">
        <span className="cc-painel-icone">
          <Icone nome={icone} tamanho={16} />
        </span>
        <h3>{titulo}</h3>
        {extra && <div className="cc-painel-extra">{extra}</div>}
      </header>
      {children}
    </section>
  );
}

export function Arco({
  fracao,
  numero,
  linhas,
  rotuloAria,
  marcas = [],
}: {
  fracao: number | null;
  numero: string;
  linhas: string[];
  rotuloAria: string;
  marcas?: { p: number; classe: string }[];
}) {
  const C = 110;
  const R = 86;
  const ponto = (graus: number, raio: number) => {
    const a = (graus * Math.PI) / 180;
    return [C + raio * Math.cos(a), C + raio * Math.sin(a)];
  };
  const [x0, y0] = ponto(150, R);
  const [x1, y1] = ponto(390, R);
  const arco = `M${x0},${y0} A${R},${R} 0 1 1 ${x1},${y1}`;
  return (
    <svg className="cc-arco" viewBox="0 0 220 190" role="img" aria-label={rotuloAria}>
      <path className="cc-medidor-trilho" d={arco} pathLength={100} />
      {fracao !== null && (
        <path
          className="cc-medidor-valor"
          d={arco}
          pathLength={100}
          strokeDasharray={`${fracao * 100} 100`}
        />
      )}
      {marcas.map(({ p, classe }) => {
        const g = 150 + 240 * p;
        const [a, b] = ponto(g, R - 15);
        const [e, f] = ponto(g, R + 15);
        return <line key={classe} className={classe} x1={a} y1={b} x2={e} y2={f} />;
      })}
      <text className="cc-medidor-numero" x={C} y={112} textAnchor="middle">
        {numero}
      </text>
      {linhas.map((l, i) => (
        <text key={l} className="cc-medidor-rotulo" x={C} y={136 + i * 18} textAnchor="middle">
          {l}
        </text>
      ))}
    </svg>
  );
}

function Medidor({ r }: { r: ResumoCamada }) {
  const marcas = [
    ...(r.pedia !== null ? [{ p: r.pedia, classe: 'cc-marca-pedia' }] : []),
    ...(r.prometido !== null ? [{ p: r.prometido, classe: 'cc-marca-prometido' }] : []),
  ];
  return (
    <div className="cc-medidor">
      <Arco
        fracao={r.acerto}
        numero={r.acerto === null ? '—' : p1(r.acerto)}
        linhas={['ACERTO REAL', `${r.green} green · ${r.red} red`]}
        rotuloAria={
          r.acerto === null
            ? 'Acerto: ainda sem jogo apurado'
            : `Acerto de ${p1(r.acerto)} em ${r.green + r.red} apostas`
        }
        marcas={marcas}
      />
      <ul className="cc-legenda">
        <li>
          <i className="cc-leg-real" /> Real
        </li>
        <li>
          <i className="cc-leg-prometido" /> Prometido{' '}
          {r.prometido === null ? '—' : p1(r.prometido)}
        </li>
        <li>
          <i className="cc-leg-pedia" /> Odd pedia {r.pedia === null ? '—' : p1(r.pedia)}
        </li>
      </ul>
    </div>
  );
}

function Kpi({
  icone,
  rotulo,
  valor,
  tom,
  sub,
}: {
  icone: NomeIcone;
  rotulo: string;
  valor: ReactNode;
  tom?: 'ok' | 'erro';
  sub?: string;
}) {
  return (
    <div className={`cc-kpi ${tom ? `cc-kpi-${tom}` : ''}`}>
      <span className="cc-kpi-rotulo">
        <Icone nome={icone} tamanho={14} /> {rotulo}
      </span>
      <strong className="cc-kpi-valor">{valor}</strong>
      {sub && <span className="cc-kpi-sub">{sub}</span>}
    </div>
  );
}

const tom = (x: number | null) => (x === null || x === 0 ? undefined : x > 0 ? 'ok' : 'erro');

function Kpis({ r, camada }: { r: ResumoCamada; camada: Camada }) {
  const unidades = r.apuradas ? sinal(r.unidades, n2) : '—';
  const roi = r.roi === null ? '—' : sinal(r.roi, p1);
  const odd = r.oddMedia === null ? '—' : n2(r.oddMedia);
  const comuns = (
    <>
      <Kpi
        icone="modelo"
        rotulo="Unidades"
        valor={unidades}
        tom={tom(r.apuradas ? r.unidades : null)}
        sub="1 un. por aposta"
      />
      <Kpi icone="cerebro" rotulo="ROI" valor={roi} tom={tom(r.roi)} />
      <Kpi icone="info" rotulo="Odd média" valor={odd} />
    </>
  );
  if (camada === 'bet')
    return (
      <div className="cc-kpis">
        <Kpi
          icone="alvo"
          rotulo="CLV médio"
          valor={r.clvMedio === null ? '—' : sinal(r.clvMedio, p1)}
          tom={tom(r.clvMedio)}
          sub={`${r.nClv} com fechamento`}
        />
        <Kpi
          icone="lupa"
          rotulo="EV médio"
          valor={r.evMedio === null ? '—' : sinal(r.evMedio, p1)}
          sub="na hora da análise"
        />
        <Kpi
          icone="relogio"
          rotulo="Pendentes"
          valor={r.pendentes}
          sub={`${r.total} BET no total`}
        />
        {comuns}
      </div>
    );
  return (
    <div className="cc-kpis">
      <Kpi icone="trofeu" rotulo="Green" valor={r.green} tom={r.green ? 'ok' : undefined} />
      <Kpi icone="proibido" rotulo="Red" valor={r.red} tom={r.red ? 'erro' : undefined} />
      <Kpi
        icone="relogio"
        rotulo="Pendentes"
        valor={r.pendentes}
        sub={`${r.devolvidas} devolvida(s)`}
      />
      {comuns}
    </div>
  );
}

function Prova({
  r,
  camada,
  mostrarSorte,
}: {
  r: ResumoCamada;
  camada: Camada;
  mostrarSorte: boolean;
}) {
  const meta = camada === 'bet' ? METAS_CLV : JOGOS_PARA_CONFIAR;
  const feito = camada === 'bet' ? r.nClv : r.apuradas;
  const unidade = camada === 'bet' ? 'apostas com fechamento' : 'jogos apurados';
  return (
    <div className="cc-prova">
      <div className="cc-prova-topo">
        <span>Amostra para confiar</span>
        <b>
          {feito} de {meta} {unidade}
        </b>
      </div>
      <div
        className="cc-barra"
        role="progressbar"
        aria-valuenow={Math.min(feito, meta)}
        aria-valuemin={0}
        aria-valuemax={meta}
      >
        <i style={{ width: `${Math.min(100, (feito / meta) * 100)}%` }} />
      </div>
      {mostrarSorte && r.sorte !== null && (
        <p>
          <b>Sorte ou método?</b> Acertando só o que a odd pede, um resultado assim ou melhor sairia{' '}
          <b>{p1(r.sorte)}</b> das vezes.{' '}
          {r.sorte > 0.05 ? 'Ainda pode ser só sorte.' : 'Difícil ser só sorte, mas siga medindo.'}
        </p>
      )}
    </div>
  );
}

export function CurvaNeon({ curva }: { curva: PontoCamada[] }) {
  const [ref, W] = useLargura(640);
  const [foco, setFoco] = useState<number | null>(null);
  const id = useId().replace(/:/g, '');
  if (!curva.length)
    return <p className="cc-vazio">A curva começa quando a primeira aposta for apurada.</p>;
  const pontos = [{ id: 'inicio', jogo: 'Início', data: '', lucro: 0, acumulado: 0 }, ...curva];
  const H = 230;
  const m = { e: 12, d: 54, t: 18, b: 14 };
  const vals = pontos.map((p) => p.acumulado);
  const max = Math.max(0, ...vals);
  const min = Math.min(0, ...vals);
  const faixa = max - min || 1;
  const x = (i: number) => m.e + (i / (pontos.length - 1)) * (W - m.e - m.d);
  const y = (v: number) => m.t + ((max - v) / faixa) * (H - m.t - m.b);
  const linha = pontos.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.acumulado)}`).join(' ');
  const area = `${linha} L${x(pontos.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const ultimo = pontos[pontos.length - 1];
  const f = foco === null ? null : pontos[foco];
  const passo = (W - m.e - m.d) / (pontos.length - 1);
  return (
    <div className="cc-curva" ref={ref}>
      <svg
        width={W}
        height={H}
        role="img"
        aria-label={`Unidades acumuladas: ${sinal(ultimo.acumulado, n2)} depois de ${curva.length} apostas`}
        onMouseLeave={() => setFoco(null)}
      >
        <defs>
          <linearGradient id={`area-${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" className="cc-area-topo" />
            <stop offset="1" className="cc-area-fim" />
          </linearGradient>
        </defs>
        {max > 0 && (
          <>
            <line className="cc-grade-linha" x1={m.e} x2={W - m.d} y1={y(max)} y2={y(max)} />
            <text className="cc-eixo" x={W - m.d + 8} y={y(max) + 4}>
              {sinal(max, n2)}
            </text>
          </>
        )}
        {min < 0 && (
          <>
            <line className="cc-grade-linha" x1={m.e} x2={W - m.d} y1={y(min)} y2={y(min)} />
            <text className="cc-eixo" x={W - m.d + 8} y={y(min) + 4}>
              {sinal(min, n2)}
            </text>
          </>
        )}
        <line className="cc-linha-zero" x1={m.e} x2={W - m.d} y1={y(0)} y2={y(0)} />
        <text className="cc-eixo" x={W - m.d + 8} y={y(0) + 4}>
          0
        </text>
        <path d={area} fill={`url(#area-${id})`} />
        <path className="cc-curva-brilho" d={linha} />
        <path className="cc-curva-linha" d={linha} />
        {foco !== null && (
          <line className="cc-mira" x1={x(foco)} x2={x(foco)} y1={m.t} y2={H - m.b} />
        )}
        {pontos.map((p, i) => (
          <circle
            key={p.id}
            className={`cc-curva-ponto ${i === foco ? 'ativo' : ''}`}
            cx={x(i)}
            cy={y(p.acumulado)}
            r={i === foco ? 6 : 4}
          />
        ))}
        {pontos.map((p, i) => (
          <rect
            key={`alvo-${p.id}`}
            x={x(i) - passo / 2}
            y={0}
            width={passo}
            height={H}
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
            left: x(foco!),
            transform: `translateX(${foco! > pontos.length / 2 ? 'calc(-100% - 10px)' : '10px'})`,
          }}
        >
          <strong>{f.jogo}</strong>
          {f.data && <span>{dataBr(f.data)}</span>}
          {foco! > 0 && <span>nesta aposta: {sinal(f.lucro, n2)} un.</span>}
          <span>acumulado: {sinal(f.acumulado, n2)} un.</span>
        </div>
      )}
    </div>
  );
}

const posicao = (v: number) => `${Math.max(0, Math.min(1, (v - 0.4) / 0.6)) * 100}%`;

function PrometidoReal({ linhas }: { linhas: LinhaPrometido[] }) {
  if (!linhas.length)
    return (
      <p className="cc-vazio">Aparece quando houver green ou red em alguma faixa de chance.</p>
    );
  return (
    <>
      <ul className="cc-legenda">
        <li>
          <i className="cc-leg-real" /> Real
        </li>
        <li>
          <i className="cc-leg-prometido" /> Prometido
        </li>
        <li>
          <i className="cc-leg-pedia" /> Odd pedia
        </li>
      </ul>
      <div className="cc-haltere">
        {linhas.map((l) => {
          const [de, ate] = [l.acerto, l.prometido].sort((a, b) => a - b);
          return (
            <div
              key={l.nome}
              className="cc-haltere-linha"
              title={`${l.nome}: real ${p1(l.acerto)} em ${l.n} aposta(s), prometido ${p1(l.prometido)}, odd pedia ${p1(l.pedia)}`}
            >
              <div className="cc-haltere-nome">
                <b>{l.nome}</b>
                <span>
                  {l.green}G {l.red}R
                </span>
              </div>
              <div className="cc-haltere-trilho">
                <i
                  className="cc-haltere-ligacao"
                  style={{ left: posicao(de), right: `calc(100% - ${posicao(ate)})` }}
                />
                <i className="cc-marca cc-leg-pedia" style={{ left: posicao(l.pedia) }} />
                <i className="cc-marca cc-leg-prometido" style={{ left: posicao(l.prometido) }} />
                <i className="cc-marca cc-leg-real" style={{ left: posicao(l.acerto) }} />
              </div>
              <div className="cc-haltere-valor">
                <b>{p1(l.acerto)}</b>
                <span>prom. {p1(l.prometido)}</span>
              </div>
            </div>
          );
        })}
        <div className="cc-haltere-eixo" aria-hidden="true">
          <span>40%</span>
          <span>70%</span>
          <span>100%</span>
        </div>
      </div>
    </>
  );
}

const corCalor = (u: number) => {
  const forca = Math.round(18 + Math.min(1, Math.abs(u) / 3) * 50);
  if (u === 0) return 'rgba(143, 160, 196, 0.16)';
  return `color-mix(in srgb, var(${u > 0 ? '--ok' : '--erro'}) ${forca}%, transparent)`;
};

function MapaCalor({ linhas }: { linhas: LinhaCalor[] }) {
  if (!linhas.length) return <p className="cc-vazio">Aparece quando houver aposta apurada.</p>;
  return (
    <div className="tabela-rolavel">
      <table className="cc-calor">
        <thead>
          <tr>
            <th>Mercado</th>
            {COLUNAS_ODD.map(([nome]) => (
              <th key={nome}>{nome}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.familia}>
              <th scope="row">{l.familia}</th>
              {l.celulas.map((c, i) =>
                c ? (
                  <td
                    key={COLUNAS_ODD[i][0]}
                    style={{ background: corCalor(c.unidades) }}
                    title={`${l.familia}, odd ${COLUNAS_ODD[i][0]}: ${c.green} green, ${c.red} red, ${c.devolvidas} devolvida(s), ${sinal(c.unidades, n2)} un.`}
                  >
                    <b>{sinal(c.unidades, n2)}</b>
                    <span>
                      {c.green}G {c.red}R
                    </span>
                  </td>
                ) : (
                  <td key={COLUNAS_ODD[i][0]} className="cc-calor-vazia">
                    ·
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="cc-nota">Número grande = unidades. Verde: lucro. Vermelho: prejuízo.</p>
    </div>
  );
}

const LETRA: Record<Situacao, string> = { green: 'G', red: 'R', devolvida: 'D', pendente: '·' };

function Sequencia({ itens }: { itens: ItemCamada[] }) {
  if (!itens.length) return <p className="cc-vazio">Sem aposta apurada ainda.</p>;
  return (
    <ol className="cc-sequencia">
      {itens.slice(-16).map((i) => (
        <li
          key={i.id}
          className={`cc-seq-${i.situacao}`}
          title={`${dataBr(i.data)} · ${i.jogo}: ${i.descricao} @ ${n2(i.odd)} (${i.situacao})`}
        >
          {LETRA[i.situacao]}
        </li>
      ))}
    </ol>
  );
}

const NOME_SITUACAO: Record<Situacao, string> = {
  green: 'Green',
  red: 'Red',
  devolvida: 'Devolvida',
  pendente: 'Pendente',
};

function Lista({ itens }: { itens: ItemCamada[] }) {
  const ordem = [...itens].sort((a, b) => b.data.localeCompare(a.data));
  return (
    <ul className="cc-lista">
      {ordem.map((i) => (
        <li key={i.id}>
          <span className={`cc-situacao cc-seq-${i.situacao}`}>{NOME_SITUACAO[i.situacao]}</span>
          <span className="cc-lista-data">{dataBr(i.data)}</span>
          <span className="cc-lista-jogo">
            <b>{i.jogo}</b>
            <small>
              {i.descricao}
              {i.forte && ' · Sinal forte'}
              {i.entrou && ' · você entrou'}
            </small>
          </span>
          <span className="cc-lista-odd">
            <b>@ {n2(i.odd)}</b>
            <small>{i.casa}</small>
          </span>
          <span className="cc-lista-chance" title="chance estimada na hora da análise">
            <i style={{ width: `${i.chance * 100}%` }} />
            <small>{Math.round(i.chance * 100)}%</small>
          </span>
          <span
            className={`cc-lista-lucro ${i.lucro > 0 ? 'positivo' : i.lucro < 0 ? 'negativo' : ''}`}
          >
            {i.situacao === 'pendente' ? '—' : `${sinal(i.lucro, n2)} un.`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CartaoCamada({
  ativo,
  numero,
  nome,
  pergunta,
  r,
  aoEscolher,
}: {
  ativo: boolean;
  numero: number;
  nome: string;
  pergunta: string;
  r: ResumoCamada;
  aoEscolher: () => void;
}) {
  return (
    <button
      className={`cc-camada ${ativo ? 'ativo' : ''}`}
      aria-pressed={ativo}
      onClick={aoEscolher}
    >
      <span className="cc-camada-num">CAMADA {numero}</span>
      <strong>{nome}</strong>
      <small>{pergunta}</small>
      <span className="cc-camada-placar">
        {r.apuradas ? (
          <>
            <b>{r.acerto === null ? '—' : p1(r.acerto)}</b> acerto ·{' '}
            <b className={r.unidades >= 0 ? 'positivo' : 'negativo'}>{sinal(r.unidades, n2)} un.</b>{' '}
            · {r.apuradas} apurada(s)
          </>
        ) : (
          `${r.total} sem resultado apurado`
        )}
      </span>
    </button>
  );
}

export function CentroComando({ historico }: { historico: EntradaHistorico[] }) {
  const [camada, setCamada] = useState<Camada>('melhores');
  const [recorteM, setRecorteM] = useState<RecorteMelhores>('primeira');
  const [recorteB, setRecorteB] = useState<RecorteBet>('todas');
  const base = useMemo(
    () => ({
      melhores: resumirCamada(itensMelhores(historico, 'primeira')),
      bet: resumirCamada(itensBet(historico, 'todas')),
    }),
    [historico],
  );
  const itens = useMemo(
    () =>
      camada === 'melhores' ? itensMelhores(historico, recorteM) : itensBet(historico, recorteB),
    [historico, camada, recorteM, recorteB],
  );
  const r = useMemo(() => resumirCamada(itens), [itens]);
  const opcoes = camada === 'melhores' ? RECORTES_MELHORES : RECORTES_BET;
  const atual = camada === 'melhores' ? recorteM : recorteB;
  const mostrarSorte = camada === 'bet' || recorteM === 'primeira';
  return (
    <div className="cc">
      <div className="cc-camadas">
        <CartaoCamada
          ativo={camada === 'melhores'}
          numero={1}
          nome="Melhores entradas"
          pergunta="Qual aposta tem mais chance de bater?"
          r={base.melhores}
          aoEscolher={() => setCamada('melhores')}
        />
        <CartaoCamada
          ativo={camada === 'bet'}
          numero={2}
          nome="BET"
          pergunta="Qual odd está errada contra a referência?"
          r={base.bet}
          aoEscolher={() => setCamada('bet')}
        />
      </div>

      <div className="cc-recortes">
        {opcoes.map((o) => (
          <button
            key={o.id}
            className={atual === o.id ? 'ativo' : ''}
            aria-pressed={atual === o.id}
            onClick={() =>
              camada === 'melhores'
                ? setRecorteM(o.id as RecorteMelhores)
                : setRecorteB(o.id as RecorteBet)
            }
          >
            {o.nome}
          </button>
        ))}
        <span className="cc-recorte-dica">{opcoes.find((o) => o.id === atual)?.dica}</span>
      </div>

      {r.total === 0 ? (
        <section className="cc-painel cc-sem-dados">
          <Icone nome="info" tamanho={22} />
          <p>
            {camada === 'bet'
              ? 'Nenhum BET neste recorte. Com poucas casas, a análise técnica raramente dá BET: cole 4 ou mais casas no mesmo jogo e esta camada começa a encher.'
              : 'Nenhuma melhor entrada neste recorte ainda. Analise jogos e registre os placares.'}
          </p>
        </section>
      ) : (
        <div className="cc-grade">
          <Painel titulo="Acerto" icone="alvo" className="cc-g4">
            <Medidor r={r} />
          </Painel>
          <Painel titulo="Resultado" icone="barras" className="cc-g8">
            <Kpis r={r} camada={camada} />
            <Prova r={r} camada={camada} mostrarSorte={mostrarSorte} />
            <div className="cc-seq-bloco">
              <span>Sequência, da mais antiga para a mais recente (até 16)</span>
              <Sequencia itens={r.apuradasEmOrdem} />
            </div>
          </Painel>
          <Painel
            titulo="Unidades acumuladas"
            icone="modelo"
            className="cc-g8"
            extra={
              r.apuradas > 0 && (
                <b className={r.unidades >= 0 ? 'positivo' : 'negativo'}>
                  {sinal(r.unidades, n2)} un.
                </b>
              )
            }
          >
            <CurvaNeon curva={r.curva} />
          </Painel>
          <Painel titulo="Prometido × real" icone="cerebro" className="cc-g4">
            <PrometidoReal linhas={prometidoPorFaixa(itens)} />
          </Painel>
          <Painel titulo="Mapa de calor: mercado × odd" icone="mercado" className="cc-g12">
            <MapaCalor linhas={mapaDeCalor(itens)} />
          </Painel>
          <Painel titulo={`Apostas desta camada (${r.total})`} icone="bola" className="cc-g12">
            <Lista itens={itens} />
          </Painel>
        </div>
      )}

      {camada === 'melhores' && recorteM === 'primeira' && r.total > 0 && (
        <details className="cc-tabela">
          <summary>Ver o placar em tabela</summary>
          <PlacarDeAcerto p={placarAcerto(historico)} />
        </details>
      )}
    </div>
  );
}
