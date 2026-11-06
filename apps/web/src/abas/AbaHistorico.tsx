import { lerResultado, type ParLido, type ResultadoLido } from '@pe/parsers';
import { NOMES_ESTRATEGIA, type Estrategia, type ParPlacar, type TravasBanca } from '@pe/engine';
import { useEffect, useState } from 'react';
import { identidadesSalvas, juntarIdentidades } from '../coresTimes';
import { dec, isoLocal, num, pct, type Leitura, type Rascunho } from '../estado';
import { FormAposta } from '../componentes/FormAposta';
import { UploadPrints } from '../componentes/UploadPrints';
import { CartoesPainel, CurvaUnidades, PlacarDeAcerto } from '../componentes/PainelHistorico';
import {
  apurar,
  apurarAuto,
  balanco,
  calibracao,
  clvDe,
  exportarJson,
  gravarUltimoBackup,
  importarJson,
  lerExtrasBackup,
  lerUltimoBackup,
  filtrar,
  marco,
  minhasEntradas,
  painel,
  placarAcerto,
  registrarResultado,
  situacao,
  temPlacar,
  espacoDoHistorico,
  type EspacoDoHistorico,
  type Balanco,
  type EntradaHistorico,
  type FiltroPainel,
  type Manual,
  type Situacao,
} from '../historico';

const FILTROS: Record<FiltroPainel, { nome: string; dica: string; selo: string }> = {
  entradas: {
    nome: 'Minhas entradas',
    dica: 'Só as apostas em que você entrou de verdade (botão "Entrei nessa aposta"), com a odd que você pegou.',
    selo: '',
  },
  papel: {
    nome: 'No papel',
    dica: 'Jogos só analisados: a melhor entrada de cada análise, como se tivesse sido apostada. Mostra se o motor está barrando entradas boas (ex.: NO BET que teria dado green).',
    selo: 'seria ',
  },
};

const SELO: Record<Situacao, string> = {
  green: '🟢 GREEN',
  red: '🔴 RED',
  devolvida: '⚪ DEVOLVIDA',
  pendente: '⏳ PENDENTE',
};

const BOTOES_MANUAL: [Manual, string][] = [
  ['green', 'Green'],
  ['red', 'Red'],
  ['devolvida', 'Devolvida'],
];

const CLASSE: Record<string, string> = {
  BET: 'bet',
  WATCHLIST: 'watch',
  INVESTIGAR: 'investigar',
};

interface Props {
  historico: EntradaHistorico[];
  setHistorico: (h: EntradaHistorico[]) => void;
  abrir: (r: Rascunho) => void;
  bancaInicial: number | null;
  setBancaInicial: (v: number | null) => void;
  travas: TravasBanca | null;
  rascunhoAtual: Rascunho;
  /** false = já há uma análise aberta: ela fica */
  restaurarRascunho: (r: Rascunho) => boolean;
}

function LinhaBalanco({ titulo, b, dica }: { titulo: string; b: Balanco; dica?: string }) {
  return (
    <div className="caixa">
      <h3>{titulo}</h3>
      {b.apuradas === 0 && b.nClv === 0 ? (
        <p className="miudo">Nada apurado ainda: registre o placar e o fechamento abaixo.</p>
      ) : (
        <dl className="numeros">
          <dt>CLV médio</dt>
          <dd className={(b.clvMedio ?? 0) > 0 ? 'positivo' : 'negativo'}>
            {b.nClv ? `${pct(b.clvMedio)} (${b.nClv} com fechamento)` : '—'}
          </dd>
          <dt>Resultado</dt>
          <dd>
            {b.apuradas
              ? `${b.unidades >= 0 ? '+' : ''}${dec(b.unidades)} un. em ${b.apuradas} (ROI ${pct(b.roi)})`
              : '—'}
          </dd>
          <dt>Acerto real × previsto</dt>
          <dd>{b.apuradas ? `${pct(b.taxaAcerto)} × ${pct(b.pMedia)}` : '—'}</dd>
        </dl>
      )}
      {dica && <p className="dica">{dica}</p>}
    </div>
  );
}

function par(c: string, f: string): ParPlacar | undefined {
  const a = num(c);
  const b = num(f);
  return a === undefined || b === undefined ? undefined : { casa: a, fora: b };
}

function FormResultado({
  e,
  lido,
  onSalvar,
}: {
  e: EntradaHistorico;
  /** leitura do print do SofaScore: preenche o que veio, marca o que faltou */
  lido?: ResultadoLido;
  onSalvar: (r: EntradaHistorico['resultado']) => void;
}) {
  const r = e.resultado;
  const s = (x?: number) => (x === undefined || !Number.isFinite(x) ? '' : String(x));
  const ou = (l: ParLido | undefined, k: 'casa' | 'fora', antes?: number) => s(l?.[k] ?? antes);
  const [v, setV] = useState({
    casa: ou(lido?.placar, 'casa', r?.casa),
    fora: ou(lido?.placar, 'fora', r?.fora),
    htCasa: ou(lido?.intervalo, 'casa', r?.intervalo?.casa),
    htFora: ou(lido?.intervalo, 'fora', r?.intervalo?.fora),
    escCasa: ou(lido?.escanteios, 'casa', r?.escanteios?.casa),
    escFora: ou(lido?.escanteios, 'fora', r?.escanteios?.fora),
    carCasa: ou(lido?.amarelos, 'casa', r?.cartoes?.casa),
    carFora: ou(lido?.amarelos, 'fora', r?.cartoes?.fora),
    fechamento: s(r?.oddFechamento),
    outros: (r?.fechamentoOutros ?? []).join(' '),
  });
  const LIDOS: Partial<Record<keyof typeof v, ParLido | undefined>> = lido
    ? {
        casa: lido.placar,
        fora: lido.placar,
        htCasa: lido.intervalo,
        htFora: lido.intervalo,
        escCasa: lido.escanteios,
        escFora: lido.escanteios,
        carCasa: lido.amarelos,
        carFora: lido.amarelos,
      }
    : {};
  /** campo que o print devia trazer e veio vazio: borda vermelha para conferir */
  const faltou = (k: keyof typeof v) =>
    k in LIDOS &&
    v[k] === '' &&
    LIDOS[k]?.[k.endsWith('Fora') || k === 'fora' ? 'fora' : 'casa'] === undefined;
  const campo = (k: keyof typeof v, rotulo: string, dica?: string) => (
    <label className={faltou(k) ? 'celula-duvida' : undefined}>
      {rotulo}
      <input
        inputMode="decimal"
        value={v[k]}
        placeholder={dica}
        onChange={(x) => setV({ ...v, [k]: x.target.value })}
      />
    </label>
  );
  const placar = par(v.casa, v.fora);
  const [casa, fora] = e.resumo.jogo.split(' × ');
  const outros = v.outros
    .split(/[\s;]+/)
    .map((x) => num(x))
    .filter((x): x is number => x !== undefined && x > 1);
  return (
    <div className="grade2">
      {campo('casa', `Gols ${casa}`)}
      {campo('fora', `Gols ${fora}`)}
      {campo('htCasa', `Intervalo ${casa}`)}
      {campo('htFora', `Intervalo ${fora}`)}
      {campo('escCasa', `Escanteios ${casa}`)}
      {campo('escFora', `Escanteios ${fora}`)}
      {campo('carCasa', `Amarelos ${casa}`)}
      {campo('carFora', `Amarelos ${fora}`)}
      {campo('fechamento', 'Fechamento da referência (lado apostado)', 'ex.: 1.85')}
      {campo('outros', 'Fechamento dos outros lados', 'ex.: 2.05 (ou 3.4 5.2)')}
      <div className="linha-acoes">
        <button
          className="primario"
          disabled={!placar && num(v.fechamento) === undefined}
          onClick={() =>
            onSalvar({
              casa: placar?.casa ?? Number.NaN,
              fora: placar?.fora ?? Number.NaN,
              intervalo: par(v.htCasa, v.htFora),
              escanteios: par(v.escCasa, v.escFora),
              cartoes: par(v.carCasa, v.carFora),
              oddFechamento: num(v.fechamento),
              fechamentoOutros: outros.length ? outros : undefined,
              registradoEm: isoLocal(new Date()),
            })
          }
        >
          Salvar
        </button>
        {r && (
          <button className="discreto" onClick={() => onSalvar(undefined)}>
            Apagar resultado
          </button>
        )}
      </div>
      <p className="dica">
        O fechamento é a odd da Pinnacle/Betfair (ou do consenso) logo antes do jogo. Com os outros
        lados, o CLV sai contra o preço justo, sem margem.
      </p>
    </div>
  );
}

/** Colar o print do SofaScore (estatísticas + fluxo) e o formulário vem preenchido. */
function ResultadoComPrint({
  e,
  onSalvar,
}: {
  e: EntradaHistorico;
  onSalvar: (r: EntradaHistorico['resultado']) => void;
}) {
  const [leituras, setLeituras] = useState<Leitura[]>([]);
  const lido = leituras.length ? lerResultado(leituras.map((l) => l.texto)) : undefined;
  const par = (p?: ParLido) => `${p?.casa ?? '?'}–${p?.fora ?? '?'}`;
  return (
    <>
      <UploadPrints
        rotulo="📷 Colar print do resultado (SofaScore)"
        dica="Estatísticas da partida (Visão geral, até os cartões) + Fluxo da partida (traz FT e HT). De preferência no computador, página larga."
        leituras={leituras}
        onLido={(l) => setLeituras((x) => [...x, l])}
        onRemover={(i) => setLeituras((x) => x.filter((_, j) => j !== i))}
      />
      {lido && (
        <div className={`caixa ${lido.faltando.length ? 'alerta' : 'ok'}`}>
          Lido: placar <b>{par(lido.placar)}</b> · intervalo <b>{par(lido.intervalo)}</b> ·
          escanteios <b>{par(lido.escanteios)}</b> · amarelos <b>{par(lido.amarelos)}</b>
          {lido.vermelhos && (
            <>
              {' '}
              · vermelhos <b>{par(lido.vermelhos)}</b>
            </>
          )}
          <br />
          {lido.faltando.length
            ? `Não consegui ler: ${lido.faltando.join('; ')}. Confira esse campo (fica em vermelho quando está vazio).`
            : 'Tudo lido. Confira e clique em Salvar.'}
        </div>
      )}
      <FormResultado
        key={`${e.resultado?.registradoEm ?? 'novo'}-${leituras.length}`}
        e={e}
        lido={lido}
        onSalvar={(r) => {
          onSalvar(r);
          setLeituras([]);
        }}
      />
    </>
  );
}

export function AbaHistorico({
  historico,
  setHistorico,
  abrir,
  bancaInicial,
  setBancaInicial,
  travas,
  rascunhoAtual,
  restaurarRascunho,
}: Props) {
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'alerta'; texto: string } | null>(null);
  const [json, setJson] = useState('');
  const [filtro, setFiltro] = useState<FiltroPainel>(() =>
    minhasEntradas(historico).length ? 'entradas' : 'papel',
  );
  const [entrandoEm, setEntrandoEm] = useState<string | null>(null);
  const daVez = filtrar(historico, filtro);
  const pn = painel(daVez);
  // no papel entram também as análises sem entrada candidata (só para registrar o placar)
  const lista = filtro === 'entradas' ? daVez : historico.filter((e) => !e.aposta);
  const bets = minhasEntradas(historico);
  const comEntrada = historico.filter((e) => e.resumo.entrada);
  const cal = calibracao(historico);

  const mudar = (id: string, m: Partial<EntradaHistorico>) =>
    setHistorico(historico.map((e) => (e.id === id ? { ...e, ...m } : e)));

  const [espaco, setEspaco] = useState<EspacoDoHistorico | null>(null);
  useEffect(() => {
    let vale = true;
    void espacoDoHistorico(historico).then((e) => vale && setEspaco(e));
    return () => {
      vale = false;
    };
  }, [historico]);
  const [ultimoBackup, setUltimoBackup] = useState(lerUltimoBackup);
  const diasSemBackup = ultimoBackup
    ? Math.floor((Date.now() - Date.parse(ultimoBackup)) / 86_400_000)
    : null;

  function baixar() {
    const blob = new Blob(
      [
        exportarJson(historico, {
          banca: bancaInicial,
          rascunho: rascunhoAtual,
          ...identidadesSalvas(),
        }),
      ],
      { type: 'application/json' },
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `backup-pricing-engine-${isoLocal(new Date()).slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    const agora = isoLocal(new Date());
    gravarUltimoBackup(agora);
    setUltimoBackup(agora);
  }

  function importar(texto: string) {
    const r = importarJson(texto, historico);
    if ('erro' in r) return setMsg({ tipo: 'alerta', texto: r.erro });
    setHistorico(r.lista);
    // o que já existe neste aparelho não é substituído
    const x = lerExtrasBackup(texto);
    const veio: string[] = [`${r.novas} análise(s) nova(s)`];
    if (x.banca && !bancaInicial) {
      setBancaInicial(x.banca);
      veio.push('banca');
    }
    if (x.cores || x.escudos) {
      juntarIdentidades(x);
      veio.push('cores e escudos');
    }
    if (x.rascunho && restaurarRascunho(x.rascunho)) veio.push('análise aberta');
    setMsg({ tipo: 'ok', texto: `Importado: ${veio.join(', ')}.` });
    setJson('');
  }

  return (
    <section className="passo">
      <h2>Histórico</h2>
      <p className="dica">
        Cada análise com odds é salva sozinha até o início do jogo. Depois do jogo, registre o
        placar e o fechamento da referência: o <strong>CLV</strong> diz se há vantagem muito antes
        do lucro. Não julgue por poucos jogos. O histórico fica neste aparelho: exporte para backup
        ou para o celular.
      </p>

      <PlacarDeAcerto p={placarAcerto(historico)} />

      <div className="abas-mini">
        {(Object.keys(FILTROS) as FiltroPainel[]).map((f) => (
          <button key={f} className={f === filtro ? 'ativo' : ''} onClick={() => setFiltro(f)}>
            {FILTROS[f].nome} ({filtrar(historico, f).length})
          </button>
        ))}
      </div>
      <p className="miudo">{FILTROS[filtro].dica}</p>
      <CartoesPainel p={pn} rotulo={filtro === 'entradas' ? 'Entradas' : 'Análises'} />
      <CurvaUnidades p={pn} titulo={`Unidades acumuladas · ${FILTROS[filtro].nome}`} />

      <div className="caixa">
        <h3>Banca separada</h3>
        <label>
          Banca inicial (R$), definida uma vez
          <input
            key={bancaInicial ?? 'sem-banca'}
            inputMode="decimal"
            defaultValue={bancaInicial ?? ''}
            onBlur={(x) => setBancaInicial(num(x.target.value) ?? null)}
          />
        </label>
        {travas ? (
          <>
            <dl className="numeros">
              <dt>Banca atual</dt>
              <dd>R$ {dec(travas.bancaAtual)}</dd>
              <dt>Drawdown</dt>
              <dd className={travas.drawdown >= 0.2 ? 'negativo' : ''}>
                {pct(travas.drawdown)} (pico R$ {dec(travas.pico)})
              </dd>
              <dt>Apostado hoje</dt>
              <dd>{pct(travas.expostoHoje)} de 6%</dd>
            </dl>
            {travas.motivos.length > 0 && (
              <div className="caixa alerta">
                <ul>
                  {travas.motivos.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="dica">
              A stake de cada análise é calculada sobre a banca atual (encolhe sozinha nas perdas).
              Travas: drawdown 20% → Kelly pela metade; 30% → pausa de 7 dias; 5 perdas no dia →
              encerrar o dia. Nunca recarregar para recuperar perda.
            </p>
          </>
        ) : (
          <p className="miudo">
            Defina a banca para ligar as travas automáticas e ver a stake em R$.
          </p>
        )}
      </div>

      <details className="caixa">
        <summary>
          <strong>CLV, estratégias e calibração</strong>
        </summary>
        <LinhaBalanco
          titulo={`Minhas entradas: ${bets.length}`}
          b={balanco(bets)}
          dica="1 unidade por aposta. CLV positivo = você pega odds melhores que o fechamento justo."
        />
        {(['S1', 'S2', 'S3', 'S4'] as Estrategia[]).map((s) => {
          const daS = bets.filter((e) => e.resumo.entrada?.estrategia === s);
          if (!daS.length) return null;
          const b = balanco(daS);
          return (
            <LinhaBalanco
              key={s}
              titulo={`${NOMES_ESTRATEGIA[s]}: ${daS.length}`}
              b={b}
              dica={marco(b)}
            />
          );
        })}
        <LinhaBalanco
          titulo={`Todas as melhores entradas, no papel: ${comEntrada.length}`}
          b={balanco(comEntrada)}
          dica="Inclui WATCHLIST, INVESTIGAR e NO BET como se tivessem sido apostadas: mostra se os gates estão barrando entradas boas ou ruins."
        />
        <div className="caixa">
          <h3>Modelo × mercado (Brier, {cal.jogos} jogos)</h3>
          {cal.brier1x2 || cal.brierOU ? (
            <dl className="numeros">
              {cal.brier1x2 && (
                <>
                  <dt>1X2</dt>
                  <dd>
                    modelo {cal.brier1x2.modelo.toFixed(3)} × mercado{' '}
                    {cal.brier1x2.mercado.toFixed(3)}
                  </dd>
                </>
              )}
              {cal.brierOU && (
                <>
                  <dt>Over/Under 2.5</dt>
                  <dd>
                    modelo {cal.brierOU.modelo.toFixed(3)} × mercado{' '}
                    {cal.brierOU.mercado.toFixed(3)}
                  </dd>
                </>
              )}
            </dl>
          ) : (
            <p className="miudo">Registre placares de jogos analisados (inclusive NO BET).</p>
          )}
          <p className="dica">
            Menor = melhor. Se o modelo não ganhar do mercado em ~100 jogos, reduzir o peso dele.
          </p>
        </div>
      </details>

      <h3>
        {FILTROS[filtro].nome} ({lista.length})
      </h3>

      {historico.length === 0 && <p>Nenhuma análise salva ainda.</p>}
      {historico.length > 0 && lista.length === 0 && (
        <p className="miudo">
          {filtro === 'entradas'
            ? 'Nenhuma entrada ainda. Quando apostar, use "Entrei nessa aposta" na Análise (ou aqui, em No papel).'
            : 'Nenhuma análise sem entrada.'}
        </p>
      )}
      {lista.map((e) => {
        const ap = apurar(e);
        const auto = apurarAuto(e);
        const ent = e.resumo.entrada;
        const c = clvDe(e);
        const sit = ent ? situacao(e) : null;
        return (
          <details key={e.id} className="caixa linha-historico">
            <summary>
              {sit && (
                <span className={`selo-resultado ${sit} ${e.aposta ? '' : 'papel'}`}>
                  {SELO[sit]}
                  {!e.aposta && sit !== 'pendente' && <small>no papel</small>}
                </span>
              )}
              <span className="lh-data">
                {e.resumo.inicio.slice(0, 10).split('-').reverse().slice(0, 2).join('/')}
              </span>
              <span className="lh-jogo">
                <strong>{e.resumo.jogo}</strong>
                {temPlacar(e) && (
                  <span className="lh-placar">
                    {e.resultado!.casa}–{e.resultado!.fora}
                  </span>
                )}
                <span className="miudo">
                  <span className={`selo ${CLASSE[e.resumo.decisao ?? ''] ?? 'nobet'}`}>
                    {e.resumo.rotulo}
                  </span>
                  {e.resumo.competicao && ` ${e.resumo.competicao}`}
                </span>
              </span>
              <span className="lh-entrada">
                {ent ? (
                  <>
                    {ent.descricao}{' '}
                    <b>
                      @ {e.aposta?.odd ?? ent.odd}
                      {e.aposta && ` · ${e.aposta.casa}`}
                    </b>
                    <span className="miudo">
                      EV {pct(ent.ev)}
                      {ap?.ok && ` · ${ap.lucro >= 0 ? '+' : ''}${dec(ap.lucro)} un.`}
                      {c !== null && ` · CLV ${pct(c)}`}
                    </span>
                  </>
                ) : (
                  <span className="miudo">sem entrada candidata</span>
                )}
              </span>
            </summary>
            {ent ? (
              <p>
                Entrada: <strong>{ent.descricao}</strong> @ {ent.odd} ({ent.casa}) · EV{' '}
                {pct(ent.ev)}
                {ent.nivel && ` · ${ent.nivel}`}
                {ent.estrategia && ` · ${ent.estrategia}`}
                {ent.oddMinima !== undefined && ` · odd mínima ${dec(ent.oddMinima)}`}
                {ent.stake !== undefined &&
                  ` · stake ${pct(ent.stake, 2)}${ent.stakeValor !== undefined ? ` (R$ ${dec(ent.stakeValor)})` : ''}`}
              </p>
            ) : (
              <p className="miudo">Sem entrada candidata.</p>
            )}
            <ul className="miudo">
              {e.resumo.motivos.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            {e.aposta ? (
              <p className="entrou">
                ✅ Você entrou: @ {e.aposta.odd} na {e.aposta.casa}
                {e.aposta.valor !== undefined && ` · R$ ${dec(e.aposta.valor)}`} · em{' '}
                {e.aposta.feitaEm.slice(0, 16).replace('T', ' ')}{' '}
                <button
                  className="discreto mini"
                  onClick={() =>
                    e.irmaDe
                      ? confirm('Desfazer esta aposta? Ela sai do histórico.') &&
                        setHistorico(historico.filter((x) => x.id !== e.id))
                      : confirm('Desfazer a entrada? A análise volta para "No papel".') &&
                        mudar(e.id, { aposta: undefined })
                  }
                >
                  desfazer
                </button>
              </p>
            ) : (
              ent &&
              (entrandoEm === e.id ? (
                <FormAposta
                  entrada={ent}
                  decisao={e.resumo.decisao}
                  onCancelar={() => setEntrandoEm(null)}
                  onConfirmar={(aposta) => {
                    mudar(e.id, { aposta });
                    setEntrandoEm(null);
                  }}
                />
              ) : (
                <button className="mini" onClick={() => setEntrandoEm(e.id)}>
                  ✅ Entrei nessa aposta
                </button>
              ))
            )}
            {ap && !ap.ok && <div className="caixa alerta">Apuração: {ap.falta}</div>}
            {ent && !auto?.ok && (
              <div className="marcar-manual">
                <span className="miudo">Marcar à mão:</span>
                {BOTOES_MANUAL.map(([m, nome]) => (
                  <button
                    key={m}
                    className={`mini ${m} ${e.manual === m ? 'ativo' : ''}`}
                    onClick={() => mudar(e.id, { manual: e.manual === m ? undefined : m })}
                  >
                    {nome}
                  </button>
                ))}
              </div>
            )}
            <h4>Resultado e fechamento</h4>
            <ResultadoComPrint
              e={e}
              onSalvar={(resultado) => setHistorico(registrarResultado(historico, e.id, resultado))}
            />
            <div className="linha-acoes">
              <button onClick={() => abrir(e.rascunho)}>Abrir a análise</button>
              <button
                className="perigo mini"
                onClick={() =>
                  confirm(`Apagar ${e.resumo.jogo} do histórico?`) &&
                  setHistorico(historico.filter((x) => x.id !== e.id))
                }
              >
                apagar
              </button>
            </div>
            <p className="miudo">
              Salva em {e.salvoEm.slice(0, 16).replace('T', ' ')} · protocolo{' '}
              {e.resumo.protocolo ?? 'V3.3'}
            </p>
          </details>
        );
      })}

      <h3>Backup</h3>
      <p className="dica">
        Tudo fica só neste navegador. O arquivo leva o histórico, a banca, a análise aberta, as
        cores e os escudos; as fotos de figurinhas e da galeria ficam de fora. Ao importar, o que já
        existe aqui não é substituído.
      </p>
      {espaco && (
        <p className={`miudo${espaco.fracao >= 0.7 ? ' alerta-txt' : ''}`}>
          Histórico: {dec(espaco.mb, 1).replace('.', ',')} MB,{' '}
          {espaco.noBanco ? 'no banco do navegador' : 'no armazenamento simples do navegador'}
          {espaco.cabem !== null &&
            ` · ${espaco.cabem > 9999 ? 'cabem mais de 10 mil análises' : `cabem cerca de mais ${espaco.cabem} análises`}`}
          {espaco.noBanco &&
            (espaco.protegido
              ? ' · protegido contra limpeza automática'
              : ' · o navegador pode limpar se faltar espaço no aparelho, então mantenha o backup em dia')}
          .
          {espaco.fracao >= 0.7 &&
            ' Está enchendo: exporte um backup; quando encher, as análises novas deixam de ser gravadas.'}
        </p>
      )}
      {historico.length > 0 && (diasSemBackup === null || diasSemBackup >= 7) && (
        <div className="caixa alerta miudo">
          {diasSemBackup === null
            ? 'Você ainda não fez backup neste navegador.'
            : `Último backup há ${diasSemBackup} dias.`}{' '}
          Se limpar o navegador, sem backup se perde tudo.
        </div>
      )}
      <div className="linha-acoes">
        <button onClick={baixar}>⬇️ Exportar backup</button>
        <label className="botao">
          ⬆️ Importar arquivo
          <input
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (x) => {
              const f = x.target.files?.[0];
              if (f) importar(await f.text());
              x.target.value = '';
            }}
          />
        </label>
      </div>
      <details>
        <summary>Colar JSON</summary>
        <textarea rows={4} value={json} onChange={(x) => setJson(x.target.value)} />
        <button onClick={() => importar(json)} disabled={!json.trim()}>
          Importar
        </button>
      </details>
      {msg && <div className={`caixa ${msg.tipo}`}>{msg.texto}</div>}
    </section>
  );
}
