import { lerResultado, type ParLido, type ResultadoLido } from '@pe/parsers';
import { NOMES_ESTRATEGIA, type Estrategia, type TravasBanca } from '@pe/engine';
import { useEffect, useState } from 'react';
import {
  abrirBancoEvidencias,
  desfazerImportacao,
  importarEvidencias,
  importarEvidenciasEmLotes,
  dependentesDoDesfazer,
  importacoesVivas,
  lerDiarios,
  lotesDoDesfazer,
  paginasDeEvidencias,
  type DiarioImportacao,
} from '../armazemEvidencias';
import {
  ehGzip,
  evidenciasDoBackupGz,
  FORMATO_BACKUP,
  montarBackupGz,
  verificarBackupGz,
  verificarEvidencias,
  VERSAO_BACKUP_GZ,
} from '../backupGz';
import { identidadesSalvas, juntarIdentidades } from '../coresTimes';
import { dec, isoLocal, num, pct, type Leitura, type Rascunho } from '../estado';
import { lerOdd, lerOddsDosOutrosLados, lerParInteiro } from '../placar';
import { EscolherAposta } from '../componentes/EscolherAposta';
import { PainelMultiplas } from '../componentes/MontarMultipla';
import { UploadPrints } from '../componentes/UploadPrints';
import { juntarMultiplas, painelComMultiplas, type Multipla } from '../multiplas';
import { ehMelhorEntrada } from '../camadas';
import { CentroComando, CurvaNeon, Kpi, Painel } from '../componentes/CentroComando';
import { CartoesPainel } from '../componentes/PainelHistorico';
import {
  apostasDoJogo,
  apurar,
  apurarAuto,
  balanco,
  calibracao,
  clvDe,
  extrasDoBackup,
  gravarUltimoBackup,
  importarBackup,
  lerUltimoBackup,
  filtrar,
  marco,
  minhasEntradas,
  painel,
  registrarAposta,
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
  multiplas?: Multipla[];
  setMultiplas?: (l: Multipla[]) => void;
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

export function FormResultado({
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
  // validação do aplicativo (placar.ts): inteiros não negativos nos pares; odds finitas e maiores que 1
  const placar = lerParInteiro(v.casa, v.fora);
  const intervalo = lerParInteiro(v.htCasa, v.htFora);
  const escanteios = lerParInteiro(v.escCasa, v.escFora);
  const cartoes = lerParInteiro(v.carCasa, v.carFora);
  const fechamento = lerOdd(v.fechamento);
  const outros = lerOddsDosOutrosLados(v.outros);
  const verificacoes: [string, { estado: string; motivo?: string }, (keyof typeof v)[]][] = [
    ['Gols', placar, ['casa', 'fora']],
    ['Intervalo', intervalo, ['htCasa', 'htFora']],
    ['Escanteios', escanteios, ['escCasa', 'escFora']],
    ['Amarelos', cartoes, ['carCasa', 'carFora']],
    ['Fechamento', fechamento, ['fechamento']],
    ['Outros lados', outros, ['outros']],
  ];
  const erros = verificacoes.filter(([, l]) => l.estado === 'invalido');
  const invalidos = new Set<keyof typeof v>(erros.flatMap(([, , campos]) => campos));
  const temErro = erros.length > 0;
  /** campo que o print devia trazer e veio vazio: borda vermelha para conferir */
  const faltou = (k: keyof typeof v) =>
    k in LIDOS &&
    v[k] === '' &&
    LIDOS[k]?.[k.endsWith('Fora') || k === 'fora' ? 'fora' : 'casa'] === undefined;
  const campo = (k: keyof typeof v, rotulo: string, dica?: string) => (
    <label className={faltou(k) || invalidos.has(k) ? 'celula-duvida' : undefined}>
      {rotulo}
      <input
        inputMode="decimal"
        value={v[k]}
        placeholder={dica}
        onChange={(x) => setV({ ...v, [k]: x.target.value })}
      />
    </label>
  );
  const [casa, fora] = e.resumo.jogo.split(' × ');
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
          disabled={temErro || (placar.estado !== 'ok' && fechamento.estado !== 'ok')}
          onClick={() =>
            onSalvar({
              // sem placar (só o fechamento) continua NaN: não se inventa placar
              casa: placar.estado === 'ok' ? placar.valor.casa : Number.NaN,
              fora: placar.estado === 'ok' ? placar.valor.fora : Number.NaN,
              intervalo: intervalo.estado === 'ok' ? intervalo.valor : undefined,
              escanteios: escanteios.estado === 'ok' ? escanteios.valor : undefined,
              cartoes: cartoes.estado === 'ok' ? cartoes.valor : undefined,
              oddFechamento: fechamento.estado === 'ok' ? fechamento.valor : undefined,
              fechamentoOutros: outros.estado === 'ok' ? outros.valor : undefined,
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
      {temErro && (
        <div className="dica" role="alert">
          {erros.map(([rotulo, l]) => (
            <p key={rotulo}>
              {rotulo}: {l.motivo}
            </p>
          ))}
        </div>
      )}
      <p className="dica">
        O fechamento é a odd de referência (o consenso das casas) logo antes do jogo. Com os outros
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
  multiplas = [],
  setMultiplas = () => undefined,
  rascunhoAtual,
  restaurarRascunho,
}: Props) {
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'alerta'; texto: string } | null>(null);
  const [json, setJson] = useState('');
  const [filtro, setFiltro] = useState<FiltroPainel>(() =>
    minhasEntradas(historico).length || multiplas.length ? 'entradas' : 'papel',
  );
  const [entrandoEm, setEntrandoEm] = useState<string | null>(null);
  const daVez = filtrar(historico, filtro);
  const pn =
    filtro === 'entradas' ? painelComMultiplas(painel(daVez), multiplas, historico) : painel(daVez);
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

  const [diarios, setDiarios] = useState<DiarioImportacao[]>([]);
  // importações rodando agora (nesta ou em outra aba): não se oferece desfazer no meio delas
  const [vivas, setVivas] = useState<Set<string>>(new Set());
  const lerPendentes = () =>
    void Promise.all([lerDiarios(), importacoesVivas()])
      .then(([d, v]) => {
        setDiarios(d);
        setVivas(v);
      })
      .catch(() => setDiarios([]));
  useEffect(lerPendentes, []);
  // importações que perderam revisões porque outra foi desfeita: aviso até reimportar
  const desfalcadas = diarios.filter((d) => d.estado === 'concluida' && d.desfalques?.length);
  const pendentes = diarios.filter((d) => d.estado === 'em-andamento' || d.estado === 'falhou');
  // concluídas que podem ser desfeitas (as tentativas incorporadas vão junto com a que as completou)
  const concluidas = diarios
    .filter(
      (d) => d.estado === 'concluida' && !d.completadaPor && (d.novas > 0 || !!d.incorpora?.length),
    )
    .sort((a, b) => b.atualizadaEm.localeCompare(a.atualizadaEm));

  /**
   * Backup versão 3 (.json.gz): histórico e extras na 1ª linha, uma revisão de evidência por
   * linha, escrito em fluxo (nunca uma string única). Banco de evidências que não abre: o
   * histórico sai sozinho, dito no arquivo e aqui. Leitura que falha no meio: nenhum arquivo.
   */
  async function baixar() {
    setMsg({ tipo: 'ok', texto: 'Montando o backup compactado…' });
    try {
      const { blob, revisoes, semEvidencias } = await montarBackupGz(
        {
          formato: FORMATO_BACKUP,
          versao: VERSAO_BACKUP_GZ,
          exportadoEm: isoLocal(new Date()),
          historico,
          banca: bancaInicial,
          rascunho: rascunhoAtual,
          ...identidadesSalvas(),
          multiplas,
        },
        { abrir: abrirBancoEvidencias, paginas: () => paginasDeEvidencias() },
      );
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `backup-pricing-engine-${isoLocal(new Date()).slice(0, 10)}.json.gz`;
      a.click();
      URL.revokeObjectURL(a.href);
      const agora = isoLocal(new Date());
      gravarUltimoBackup(agora);
      setUltimoBackup(agora);
      const mb = (blob.size / 1_048_576).toFixed(1);
      setMsg(
        semEvidencias
          ? {
              tipo: 'alerta',
              texto: `Backup baixado (${mb} MB) SEM as evidências: o banco de evidências não abriu neste aparelho (${semEvidencias}). O arquivo registra isso no cabeçalho.`,
            }
          : {
              tipo: 'ok',
              texto: `Backup baixado: ${historico.length} análise(s) e ${revisoes} revisão(ões) de evidência, ${mb} MB compactado.`,
            },
      );
    } catch (e) {
      setMsg({ tipo: 'alerta', texto: `O backup não foi gerado: ${(e as Error).message}` });
    }
  }

  /** Arquivo escolhido: .json.gz (versão 3) pelo caminho em fluxo; .json antigo pelo de sempre. */
  async function importarArquivo(f: File) {
    const inicio = new Uint8Array(await f.slice(0, 2).arrayBuffer());
    if (ehGzip(inicio)) await importarGz(f);
    else importar(await f.text());
  }

  /** Aplica histórico e extras (o que já existe neste aparelho não é substituído). */
  function aplicarBackup(bruto: unknown): string[] | null {
    const r = importarBackup(bruto, historico);
    if ('erro' in r) {
      setMsg({ tipo: 'alerta', texto: r.erro });
      return null;
    }
    setHistorico(r.lista);
    const x = extrasDoBackup(bruto);
    const veio: string[] = [`${r.novas} análise(s) nova(s)`];
    if (x.banca && !bancaInicial) {
      setBancaInicial(x.banca);
      veio.push('banca');
    }
    if (x.multiplas?.length) {
      setMultiplas(juntarMultiplas(multiplas, x.multiplas));
      veio.push('múltiplas');
    }
    if (x.cores || x.escudos) {
      juntarIdentidades(x);
      veio.push('cores e escudos');
    }
    if (x.rascunho && restaurarRascunho(x.rascunho)) veio.push('análise aberta');
    return veio;
  }

  /**
   * 1ª passada confere o arquivo inteiro (SHA-256 de cada revisão, rodapé, contagem) sem gravar
   * nada; só então grava, em lotes com diário. Arquivo com qualquer problema: nada importado.
   */
  async function importarGz(f: File) {
    setMsg({ tipo: 'ok', texto: 'Conferindo o arquivo (SHA-256 de cada revisão)…' });
    const v = await verificarBackupGz(() => f.stream());
    if (!v.ok)
      return setMsg({
        tipo: 'alerta',
        texto: `Arquivo recusado, nada foi importado. ${v.problemas
          .map((p) => (p.linha ? `Linha ${p.linha}: ${p.motivo}` : p.motivo))
          .join('; ')}.`,
      });
    const veio = aplicarBackup(v.cabecalho);
    if (!veio) return;
    if (v.cabecalho.evidenciasNoArquivo === 'indisponiveis')
      return setMsg({
        tipo: 'alerta',
        texto: `Importado: ${veio.join(', ')}. Este backup foi gerado SEM evidências: o banco de evidências não abriu no aparelho de origem (${String(v.cabecalho.motivoSemEvidencias ?? 'motivo não registrado')}).`,
      });
    try {
      const e = await importarEvidenciasEmLotes(
        evidenciasDoBackupGz(() => f.stream(), v.hashes),
        { arquivo: f.name, esperadas: v.revisoes, impressao: v.impressao },
        (d) =>
          setMsg({
            tipo: 'ok',
            texto: `Importando evidências: ${d.processadas} de ${d.esperadas} revisões…`,
          }),
      );
      setMsg({
        tipo: 'ok',
        texto: `Importado: ${veio.join(', ')}; evidências: ${e.novas} nova(s) (${e.renumeradas} com número novo por conflito), ${e.jaExistiam} já existiam${e.incorporadas.length ? `; completou ${e.incorporadas.length} tentativa(s) interrompida(s) deste mesmo backup` : ''}. SHA-256 conferido em ${v.revisoes} revisão(ões).`,
      });
    } catch (erro) {
      setMsg({
        tipo: 'alerta',
        texto: `Importado: ${veio.join(', ')}. Evidências: ${(erro as Error).message}. Veja o aviso de importação pendente abaixo.`,
      });
    } finally {
      lerPendentes();
    }
  }

  async function desfazer(d: DiarioImportacao) {
    // a operação inteira: ela e as tentativas interrompidas do mesmo backup que ela completou
    const lotes = lotesDoDesfazer(diarios, d.id);
    const total = diarios.filter((x) => lotes.includes(x.id)).reduce((a, x) => a + x.novas, 0);
    // outras importações que contaram estas revisões como "já existiam" ficam desfalcadas
    const afetadas = dependentesDoDesfazer(diarios, lotes);
    const aviso = afetadas.length
      ? ` ATENÇÃO: ${afetadas.map((a) => `a importação de "${a.arquivo}" contou ${a.revisoes} delas como já existentes e ficará desfalcada (reimporte esse arquivo para recompor)`).join('; ')}.`
      : '';
    if (
      !confirm(
        `Desfazer a importação de "${d.arquivo}"? Saem só as ${total} revisão(ões) que ela gravou${lotes.length > 1 ? ` (somando ${lotes.length - 1} tentativa(s) interrompida(s) que ela completou)` : ''}; o que foi gravado por este aparelho fica.${aviso}`,
      )
    )
      return;
    try {
      const n = await desfazerImportacao(d.id);
      setMsg({ tipo: 'ok', texto: `Importação desfeita: ${n} revisão(ões) removida(s).` });
    } catch (e) {
      setMsg({ tipo: 'alerta', texto: `Não consegui desfazer: ${(e as Error).message}` });
    }
    lerPendentes();
  }

  /** Backup antigo (.json, versões 1 e 2): mesmas regras, e evidências com SHA-256 conferido. */
  async function importar(texto: string) {
    let bruto: unknown;
    try {
      bruto = JSON.parse(texto);
    } catch (e) {
      return setMsg({ tipo: 'alerta', texto: `JSON inválido: ${(e as Error).message}` });
    }
    const veio = aplicarBackup(bruto);
    if (!veio) return;
    setJson('');
    const x = extrasDoBackup(bruto);
    const invalidas = x.evidenciasInvalidas
      ? ` ${x.evidenciasInvalidas} item(ns) de evidência sem a forma esperada ficaram de fora.`
      : '';
    if (!x.evidencias?.length)
      return setMsg({
        tipo: invalidas ? 'alerta' : 'ok',
        texto: `Importado: ${veio.join(', ')}.${invalidas}`,
      });
    // evidências: SHA-256 de todas antes de gravar qualquer uma; o histórico acima já entrou
    const problemas = await verificarEvidencias(x.evidencias);
    if (problemas.length)
      return setMsg({
        tipo: 'alerta',
        texto: `Importado: ${veio.join(', ')}. As evidências NÃO foram importadas (nenhuma): ${problemas.map((p) => p.motivo).join('; ')}.${invalidas}`,
      });
    try {
      const e = await importarEvidencias(x.evidencias);
      setMsg({
        tipo: invalidas ? 'alerta' : 'ok',
        texto: `Importado: ${veio.join(', ')}; evidências: ${e.novas} nova(s) (${e.renumeradas} com número novo por conflito), ${e.jaExistiam} já existiam.${invalidas}`,
      });
    } catch (erro) {
      setMsg({
        tipo: 'alerta',
        texto: `Importado: ${veio.join(', ')}. Evidências: ${(erro as Error).message}`,
      });
    } finally {
      lerPendentes();
    }
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

      <CentroComando historico={historico} />

      <h3>Registro de apostas</h3>
      <div className="abas-mini">
        {(Object.keys(FILTROS) as FiltroPainel[]).map((f) => (
          <button key={f} className={f === filtro ? 'ativo' : ''} onClick={() => setFiltro(f)}>
            {FILTROS[f].nome} (
            {filtrar(historico, f).length + (f === 'entradas' ? multiplas.length : 0)})
          </button>
        ))}
      </div>
      <p className="miudo">{FILTROS[filtro].dica}</p>
      <CartoesPainel p={pn} rotulo={filtro === 'entradas' ? 'Entradas' : 'Análises'} />
      <Painel titulo={`Unidades acumuladas · ${FILTROS[filtro].nome}`} icone="modelo">
        <CurvaNeon curva={pn.curva} />
      </Painel>

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
            <div className="cc-kpis cc-banca">
              <Kpi icone="bola" rotulo="Banca atual" valor={`R$ ${dec(travas.bancaAtual)}`} />
              {bancaInicial !== null && (
                <Kpi
                  icone="modelo"
                  rotulo="Resultado"
                  valor={`${travas.bancaAtual >= bancaInicial ? '+' : '−'}R$ ${dec(Math.abs(travas.bancaAtual - bancaInicial))}`}
                  tom={travas.bancaAtual >= bancaInicial ? 'ok' : 'erro'}
                  sub={`desde R$ ${dec(bancaInicial)}`}
                />
              )}
              <Kpi
                icone="proibido"
                rotulo="Drawdown"
                valor={pct(travas.drawdown)}
                tom={travas.drawdown >= 0.2 ? 'erro' : undefined}
                sub={`pico R$ ${dec(travas.pico)}`}
              />
              <Kpi
                icone="relogio"
                rotulo="Apostado hoje"
                valor={pct(travas.expostoHoje)}
                sub="limite de 6%"
              />
            </div>
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
        {FILTROS[filtro].nome} ({lista.length + (filtro === 'entradas' ? multiplas.length : 0)})
      </h3>

      {filtro === 'entradas' && (
        <PainelMultiplas
          multiplas={multiplas}
          historico={historico}
          onApagar={(id) => setMultiplas(multiplas.filter((m) => m.id !== id))}
        />
      )}

      {historico.length === 0 && <p>Nenhuma análise salva ainda.</p>}
      {historico.length > 0 &&
        lista.length === 0 &&
        !(filtro === 'entradas' && multiplas.length) && (
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
                  {ehMelhorEntrada(historico, e) && (
                    <span className="selo-camada">Melhor entrada</span>
                  )}
                  <span className="lh-tecnica">Técnica:</span>
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
                      @ {dec(e.aposta?.odd ?? ent.odd)}
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
                Entrada: <strong>{ent.descricao}</strong> @ {dec(ent.odd)} ({ent.casa}) · EV{' '}
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
                ✅ Você entrou: @ {dec(e.aposta.odd)} na {e.aposta.casa}
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
            ) : null}
            {entrandoEm === e.id ? (
              <EscolherAposta
                e={e}
                registradas={apostasDoJogo(historico, e.irmaDe ?? e.id)}
                onCancelar={() => setEntrandoEm(null)}
                onConfirmar={(aposta, r, d) => {
                  const { lista } = registrarAposta(
                    historico,
                    { ...r, idHistorico: e.irmaDe ?? e.id },
                    d,
                    aposta,
                  );
                  setHistorico(lista);
                  setEntrandoEm(null);
                }}
              />
            ) : (
              <button className="mini" onClick={() => setEntrandoEm(e.id)}>
                {e.aposta ? '+ Outra aposta neste jogo' : '✅ Entrei em uma aposta deste jogo'}
              </button>
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
        <button onClick={() => void baixar()}>⬇️ Exportar backup</button>
        <label className="botao">
          ⬆️ Importar arquivo
          <input
            type="file"
            accept="application/json,application/gzip,.json,.gz"
            hidden
            onChange={async (x) => {
              const f = x.target.files?.[0];
              x.target.value = '';
              if (f) await importarArquivo(f);
            }}
          />
        </label>
      </div>
      <details>
        <summary>Colar JSON</summary>
        <textarea rows={4} value={json} onChange={(x) => setJson(x.target.value)} />
        <button onClick={() => void importar(json)} disabled={!json.trim()}>
          Importar
        </button>
      </details>
      {msg && <div className={`caixa ${msg.tipo}`}>{msg.texto}</div>}
      {pendentes.map((d) => (
        <div key={d.id} className="caixa alerta">
          A importação de <strong>{d.arquivo}</strong> (
          {new Date(d.iniciadaEm).toLocaleString('pt-BR', {
            dateStyle: 'short',
            timeStyle: 'short',
          })}
          ) não terminou: {d.processadas} de {d.esperadas} revisões tratadas, {d.novas} gravada(s)
          {vivas.has(d.id) ? (
            ' — ainda está rodando (nesta ou em outra aba). Espere terminar para desfazer.'
          ) : (
            <>
              {d.erro ? ` — ${d.erro}` : ' (interrompida)'}. Importe o mesmo arquivo de novo para
              completar (nada duplica) ou desfaça só o que ela gravou.{' '}
              <button className="mini" onClick={() => void desfazer(d)}>
                Desfazer esta importação
              </button>
            </>
          )}
        </div>
      ))}
      {desfalcadas.map((d) => (
        <div key={`desfalque-${d.id}`} className="caixa alerta">
          A importação de <strong>{d.arquivo}</strong> ficou desfalcada:{' '}
          {d
            .desfalques!.map((x) => `${x.revisoes} revisão(ões) saíram ao desfazer "${x.arquivo}"`)
            .join('; ')}
          . Importe <strong>{d.arquivo}</strong> de novo para recompor (nada duplica).
        </div>
      ))}
      {concluidas.length > 0 && (
        <details>
          <summary>Importações de evidências ({concluidas.length})</summary>
          {concluidas.map((d) => (
            <div key={d.id} className="caixa">
              <strong>{d.arquivo}</strong> (
              {new Date(d.atualizadaEm).toLocaleString('pt-BR', {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
              ): {d.novas} revisão(ões) gravada(s), {d.jaExistiam} já existiam
              {d.incorpora?.length
                ? `; completou ${d.incorpora.length} tentativa(s) interrompida(s) deste mesmo backup`
                : ''}
              .{' '}
              <button className="mini" onClick={() => void desfazer(d)}>
                Desfazer esta importação
              </button>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
