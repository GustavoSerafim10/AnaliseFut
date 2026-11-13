import { useEffect, useMemo, useState } from 'react';
import { AbaAnalise } from './abas/AbaAnalise';
import { AbaDesfalques } from './abas/AbaDesfalques';
import { AbaFlashscore } from './abas/AbaFlashscore';
import { AbaHistorico } from './abas/AbaHistorico';
import { AbaJogo } from './abas/AbaJogo';
import { AbaOdds } from './abas/AbaOdds';
import { AbaPromocoes } from './abas/AbaPromocoes';
import { AbaStats } from './abas/AbaStats';
import { Estadio } from './componentes/Estadio';
import { GaleriaFundo } from './componentes/GaleriaFundo';
import { MatchCenter } from './componentes/MatchCenter';
import { Icone, type NomeIcone } from './componentes/ui';
import {
  carregarFigurinhas,
  carregarGaleria,
  gravarFigurinhas,
  gravarGaleria,
  type Figurinhas,
} from './figurinhas';
import { derivar, temTextoFlashscore } from './dados';
import { abaDoExemplo, ehExemplo, rascunhoExemplo } from './exemplo';
import { carregarRascunho, rascunhoNovo, salvarRascunho, type Rascunho } from './estado';
import {
  carregarBancaInicial,
  avisoDoBanco,
  carregarHistorico,
  gravarBancaInicial,
  gravarHistorico,
  mesmoRascunho,
  ouvirFalhaDeGravacao,
  podeSalvarSozinho,
  apostasDoJogo,
  registrarAposta,
  salvarNoHistorico,
  type ApostaFeita,
  travasDoHistorico,
  type EntradaHistorico,
} from './historico';
import {
  apostasDeMultiplas,
  valorDeMultiplasNoJogo,
  carregarMontando,
  carregarMultiplas,
  gravarMontando,
  gravarMultiplas,
  type Multipla,
  type PernaMultipla,
} from './multiplas';

type Aba =
  | {
      id:
        | 'jogo'
        | 'sofascore'
        | 'superscore'
        | 'flashscore'
        | 'desfalques'
        | 'analise'
        | 'historico'
        | 'promocoes';
    }
  | { id: 'odds'; casa: string };

const chave = (a: Aba) => (a.id === 'odds' ? `odds:${a.casa}` : a.id);

export function App() {
  // #demo: jogo de exemplo, sem tocar no rascunho nem no histórico do aparelho
  const [demo] = useState(ehExemplo);
  const [r, setR] = useState<Rascunho>(() => (demo ? rascunhoExemplo() : carregarRascunho()));
  const [aba, setAba] = useState<Aba>(() =>
    demo ? ({ id: abaDoExemplo() } as Aba) : { id: 'jogo' },
  );
  const [rascunhoCheio, setRascunhoCheio] = useState(false);
  useEffect(() => {
    if (!demo) setRascunhoCheio(!salvarRascunho(r));
  }, [r, demo]);
  const irPara = (hash: string) => {
    location.hash = hash;
    location.reload();
  };
  const [avisoHistorico, setAvisoHistorico] = useState<string | null>(avisoDoBanco);
  const [historico, setHistoricoState] = useState<EntradaHistorico[]>(carregarHistorico);
  const [bancaInicial, setBancaInicialState] = useState<number | null>(carregarBancaInicial);
  const setBancaInicial = (v: number | null) => {
    setBancaInicialState(v);
    gravarBancaInicial(v);
  };
  const [multiplas, setMultiplasState] = useState<Multipla[]>(carregarMultiplas);
  const [montando, setMontandoState] = useState<PernaMultipla[]>(carregarMontando);
  const setMultiplas = (l: Multipla[]) => {
    setMultiplasState(l);
    setAvisoHistorico(
      gravarMultiplas(l)
        ? null
        : 'Não consegui gravar a múltipla neste aparelho: exporte o backup.',
    );
  };
  const setMontando = (l: PernaMultipla[]) => {
    setMontandoState(l);
    gravarMontando(l);
  };
  // travas da banca (V4.0 seção 6) por TODAS as apostas registradas, inclusive as do jogo aberto:
  // elas já estão comprometidas (teto diário de 6% e teto de 2% por jogo). Só o botão "Entrei"
  // cria exposição; análises salvas e entradas exibidas não reservam nada.
  const travas = useMemo(() => {
    if (!bancaInicial) return undefined;
    const jogo = { casa: r.jogo.casa, fora: r.jogo.fora, data: r.jogo.data };
    return travasDoHistorico(
      historico,
      bancaInicial,
      undefined,
      apostasDeMultiplas(multiplas, historico),
      jogo,
      valorDeMultiplasNoJogo(multiplas, jogo),
    );
  }, [historico, bancaInicial, r.jogo.casa, r.jogo.fora, r.jogo.data, multiplas]);
  const d = useMemo(() => derivar(r, travas), [r, travas]);
  useEffect(() => ouvirFalhaDeGravacao(setAvisoHistorico), []);
  const setHistorico = (h: EntradaHistorico[]) => {
    setHistoricoState(h);
    // a análise aberta foi apagada: ela segue na tela, mas não volta sozinha para o histórico
    if (r.idHistorico && !h.some((e) => e.id === r.idHistorico))
      setR((x) => ({ ...x, idHistorico: undefined, naoSalvarSozinho: true }));
    setAvisoHistorico(
      gravarHistorico(h) ? null : 'Não consegui gravar o histórico neste aparelho: exporte o JSON.',
    );
  };

  function salvarAnalise(aposta?: ApostaFeita) {
    if (demo) {
      alert('Isto é só o jogo de exemplo: nada é salvo no histórico.');
      return;
    }
    const { lista, id } = aposta
      ? registrarAposta(historico, r, d, aposta)
      : salvarNoHistorico(historico, r, d);
    setHistoricoState(lista);
    setAvisoHistorico(
      gravarHistorico(lista)
        ? null
        : 'Não consegui gravar o histórico neste aparelho: exporte o backup.',
    );
    setR((x) => ({ ...x, idHistorico: id, naoSalvarSozinho: undefined }));
  }

  // salva sozinho, com uma folga para não gravar a cada tecla
  useEffect(() => {
    if (demo || !podeSalvarSozinho(r, d)) return;
    const atual = historico.find((e) => e.id === r.idHistorico);
    if (atual && mesmoRascunho(atual.rascunho, r)) return;
    const espera = setTimeout(() => {
      const { lista, id } = salvarNoHistorico(historico, r, d);
      setHistorico(lista);
      setR((x) => ({ ...x, idHistorico: id }));
    }, 1500);
    return () => clearTimeout(espera);
  }, [r, d, historico, demo]);

  function abrirDoHistorico(salvo: Rascunho) {
    if (
      !confirm(
        'Abrir esta análise? A que está aberta sai da tela; se já tinha odds, fica salva no Histórico.',
      )
    )
      return;
    setR({ ...rascunhoNovo(), ...salvo, config: { ...rascunhoNovo().config, ...salvo.config } });
    setAba({ id: 'analise' });
  }

  const contagem = (g: string) => (r.prints[g] ?? []).length;
  const grupos: { titulo: string; abas: { aba: Aba; rotulo: string; marca?: string }[] }[] = [
    { titulo: '', abas: [{ aba: { id: 'jogo' }, rotulo: 'Jogo' }] },
    {
      titulo: 'Estatísticas',
      abas: [
        {
          aba: { id: 'sofascore' },
          rotulo: 'SofaScore',
          marca: contagem('sofascore') ? String(contagem('sofascore')) : undefined,
        },
        {
          aba: { id: 'superscore' },
          rotulo: 'SuperScore',
          marca: contagem('superscore') ? String(contagem('superscore')) : undefined,
        },
        {
          aba: { id: 'flashscore' },
          rotulo: 'Flashscore',
          marca: r.flashscoreSemTexto ? '—' : temTextoFlashscore(r) ? '✓' : undefined,
        },
        {
          aba: { id: 'desfalques' },
          rotulo: 'Desfalques',
          marca: contagem('desfalques')
            ? String(contagem('desfalques'))
            : r.semDesfalques
              ? '—'
              : undefined,
        },
      ],
    },
    {
      titulo: 'Odds',
      abas: r.casas.map((casa) => {
        const n = r.odds.filter((o) => o.casa === casa).length;
        return { aba: { id: 'odds', casa } as Aba, rotulo: casa, marca: n ? String(n) : undefined };
      }),
    },
    {
      titulo: '',
      abas: [
        { aba: { id: 'analise' }, rotulo: 'Análise' },
        {
          aba: { id: 'historico' },
          rotulo: 'Histórico',
          marca: historico.length ? String(historico.length) : undefined,
        },
        { aba: { id: 'promocoes' }, rotulo: 'Promoções' },
      ],
    },
  ];

  // seções do topo: Partida · Estatísticas · Mercado · Análise · Histórico · Promoções
  const secoes: {
    id: string;
    rotulo: string;
    icone: NomeIcone;
    marca?: string;
    abas: { aba: Aba; rotulo: string; marca?: string }[];
  }[] = [
    { id: 'partida', rotulo: 'Partida', icone: 'bola', abas: grupos[0].abas },
    { id: 'estatisticas', rotulo: 'Estatísticas', icone: 'barras', abas: grupos[1].abas },
    {
      id: 'mercado',
      rotulo: 'Mercado',
      icone: 'mercado',
      marca: r.odds.length ? String(r.odds.length) : undefined,
      abas: grupos[2].abas,
    },
    { id: 'analise', rotulo: 'Análise', icone: 'modelo', abas: [grupos[3].abas[0]] },
    { id: 'historico', rotulo: 'Histórico', icone: 'historico', abas: [grupos[3].abas[1]] },
    { id: 'promocoes', rotulo: 'Promoções', icone: 'presente', abas: [grupos[3].abas[2]] },
  ];
  const secaoAtiva =
    secoes.find((sec) => sec.abas.some((x) => chave(x.aba) === chave(aba))) ??
    (aba.id === 'odds' ? secoes[2] : undefined);

  function novaCasa() {
    const nome = prompt('Nome da casa de apostas (ex.: Bet365, Betano, Superbet):')?.trim();
    if (!nome) return;
    if (!r.casas.includes(nome)) setR((x) => ({ ...x, casas: [...x.casas, nome] }));
    setAba({ id: 'odds', casa: nome });
  }

  function novaAnalise() {
    if (
      confirm(
        'Começar uma nova análise? A atual sai da tela; se já tinha odds, fica salva no Histórico.',
      )
    ) {
      setR(rascunhoNovo());
      setAba({ id: 'jogo' });
    }
  }

  // "Ver o lance": esconde o site e deixa o estádio animado em tela cheia (Esc volta)
  const [verLance, setVerLance] = useState(false);
  useEffect(() => {
    document.body.classList.toggle('so-lance', verLance);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setVerLance(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [verLance]);

  const [figurinhas, setFigurinhasState] = useState<Figurinhas>(carregarFigurinhas);
  const setFigurinhas = (f: Figurinhas) => {
    setFigurinhasState(f);
    if (!gravarFigurinhas(f))
      alert('Não consegui guardar a foto neste aparelho (armazenamento cheio ou aba privada).');
  };

  const [galeria, setGaleriaState] = useState<string[]>(carregarGaleria);
  const setGaleria = (g: string[]) => {
    if (!gravarGaleria(g)) {
      alert('Não coube no armazenamento deste aparelho: tire alguma foto da galeria.');
      return;
    }
    setGaleriaState(g);
  };

  const props = {
    r,
    setR,
    d,
    abrirExemplo: () => irPara('#demo/analise'),
    figurinhas,
    setFigurinhas,
    galeria,
    setGaleria,
    verLance: () => setVerLance(true),
    abrir: (id: 'sofascore' | 'desfalques' | 'odds' | 'analise') => {
      if (id !== 'odds') setAba({ id });
      else if (r.casas[0]) setAba({ id: 'odds', casa: r.casas[0] });
      else novaCasa();
    },
  };
  const temJogo = !!(r.jogo.casa || r.jogo.fora);
  const mostraMatchCenter = temJogo && aba.id !== 'historico' && aba.id !== 'promocoes';
  return (
    <>
      <div className="ambiente" aria-hidden="true" />
      {verLance && (
        <>
          <GaleriaFundo fotos={galeria} />
          <Estadio fotos={figurinhas} comGaleria={galeria.length > 0} />
          <button className="sair-lance" onClick={() => setVerLance(false)}>
            ✕ Voltar para a análise
          </button>
        </>
      )}
      <header className="topo">
        <div className="marca-topo">
          <svg className="logo" viewBox="0 0 48 40" aria-hidden="true">
            <path className="logo-a" d="M10 4 H40 L36 14 H20 L12 36 H2 Z" />
            <path className="logo-b" d="M22 17 H44 L38 30 H28 L25 38 H16 Z" />
          </svg>
          <div className="nome-site">Pricing Engine</div>
          <span className="pilula-versao">PRÉ-LIVE • V4.0</span>
        </div>
        <nav className="nav-principal" aria-label="Seções">
          {secoes.map((s) => (
            <button
              key={s.id}
              className={s.id === secaoAtiva?.id ? 'ativo' : ''}
              aria-current={s.id === secaoAtiva?.id ? 'page' : undefined}
              // Mercado sem casa nenhuma (todas removidas): pergunta o nome de uma nova
              onClick={() => (s.abas[0] ? setAba(s.abas[0].aba) : s.id === 'mercado' && novaCasa())}
            >
              <Icone nome={s.icone} tamanho={18} />
              {s.rotulo}
              {s.marca && <span className="marca">{s.marca}</span>}
            </button>
          ))}
        </nav>
        <div className="topo-direita">
          <div className="selo-marca">
            <Icone nome="cerebro" tamanho={30} />
            <div>
              <strong>Inteligência</strong>
              <strong>de dados esportivos</strong>
              <small>Mais dados. Melhores decisões.</small>
            </div>
          </div>
          <button
            className="icone-botao"
            title="Nova análise"
            aria-label="Nova análise"
            onClick={novaAnalise}
          >
            <Icone nome="mais" tamanho={18} />
          </button>
          <button
            className="icone-botao"
            title="Parâmetros do jogo e do modelo"
            aria-label="Parâmetros do jogo e do modelo"
            onClick={() => setAba({ id: 'jogo' })}
          >
            <Icone nome="engrenagem" tamanho={18} />
          </button>
        </div>
      </header>
      {demo && (
        <div className="faixa-demo">
          Jogo de exemplo (odds fictícias): nada aqui é salvo.{' '}
          <button className="mini" onClick={() => irPara('')}>
            sair do exemplo
          </button>
        </div>
      )}
      {secaoAtiva && (secaoAtiva.abas.length > 1 || secaoAtiva.id === 'mercado') && (
        <nav className="sub-abas" aria-label={secaoAtiva.rotulo}>
          {secaoAtiva.abas.map(({ aba: a, rotulo, marca }) => (
            <button
              key={chave(a)}
              className={chave(a) === chave(aba) ? 'ativo' : ''}
              aria-current={chave(a) === chave(aba) ? 'page' : undefined}
              onClick={() => setAba(a)}
            >
              {rotulo}
              {marca && <span className="marca">{marca}</span>}
            </button>
          ))}
          {secaoAtiva.id === 'mercado' && (
            <button className="discreto" onClick={novaCasa}>
              + casa
            </button>
          )}
        </nav>
      )}
      {mostraMatchCenter && <MatchCenter r={r} d={d} />}
      <main key={chave(aba)} className="conteudo-aba">
        {aba.id === 'jogo' && <AbaJogo {...props} />}
        {aba.id === 'sofascore' && <AbaStats {...props} fonte="sofascore" />}
        {aba.id === 'superscore' && <AbaStats {...props} fonte="superscore" />}
        {aba.id === 'flashscore' && <AbaFlashscore {...props} />}
        {aba.id === 'desfalques' && <AbaDesfalques {...props} />}
        {aba.id === 'odds' && r.casas.includes(aba.casa) && (
          <AbaOdds key={aba.casa} {...props} casa={aba.casa} />
        )}
        {aba.id === 'analise' && (
          <AbaAnalise
            {...props}
            onSalvar={() => salvarAnalise()}
            onEntrar={salvarAnalise}
            salvoNoHistorico={!!historico.find((e) => e.id === r.idHistorico)}
            apostas={apostasDoJogo(historico, r.idHistorico)}
            montando={montando}
            setMontando={setMontando}
            onRegistrarMultipla={(m) => {
              if (demo) {
                alert('Isto é só o jogo de exemplo: nada é salvo no histórico.');
                return;
              }
              setMultiplas([m, ...multiplas]);
              setMontando([]);
            }}
          />
        )}
        {aba.id === 'historico' && (
          <AbaHistorico
            historico={historico}
            setHistorico={setHistorico}
            abrir={abrirDoHistorico}
            bancaInicial={bancaInicial}
            setBancaInicial={setBancaInicial}
            travas={travas ?? null}
            multiplas={multiplas}
            setMultiplas={setMultiplas}
            rascunhoAtual={r}
            restaurarRascunho={(x) => {
              if (r.jogo.casa || r.jogo.fora) return false;
              setR({ ...rascunhoNovo(), ...x, config: { ...rascunhoNovo().config, ...x.config } });
              return true;
            }}
          />
        )}
        {aba.id === 'promocoes' && <AbaPromocoes {...props} />}
        {avisoHistorico && <div className="caixa alerta">{avisoHistorico}</div>}
        {rascunhoCheio && (
          <div className="caixa alerta">
            O navegador não deixou guardar esta análise: se fechar a página, ela se perde. Exporte
            um backup no Histórico.
          </div>
        )}
      </main>
      <footer className="rodape">
        Pricing Engine V4.0 · referência afiada × casa mole · NO BET é o padrão
      </footer>
    </>
  );
}
