/**
 * Tudo que o site mostra é DERIVADO do rascunho: textos lidos → parsers → cruzamento de
 * fontes → λ → DQ → motor → análise escrita. Nenhum número é decidido na tela.
 * A decisão é da V4.0 (referência afiada × casa mole), que só precisa das odds; o motor
 * V3.3 entra como apoio (filtro, nichos e previsão) quando há estatísticas.
 */
import {
  analisarJogo,
  analisarV4,
  avaliarDQ,
  detectarMovimentos,
  pesoModelo,
  calcularLambdaContagem,
  calcularLambdaModelo,
  gerarRelatorio,
  type AjusteLambda,
  type DQ,
  type Estatistica,
  type LambdasContagem,
  type LinhaOdd,
  type Relatorio,
  type ResultadoLambdaContagem,
  type ResultadoAnalise,
  type ResultadoLambdaModelo,
  type ResultadoV4,
  type Atraso,
  type Movimento,
  type TravasBanca,
} from '@pe/engine';
import {
  avaliarImpactoDesfalques,
  checarSanidade,
  consolidar,
  destaquesComparativos,
  estatisticasContagem,
  estatisticasParaModelo,
  juntarEscalacoes,
  juntarLeiturasStats,
  juntarUltimas,
  lerEscalacao,
  mesmoJogador,
  lerOddsCasa,
  lerClassificacao,
  lerDesfalques,
  lerEstatisticas,
  lerTextoFlashscore,
  lerUltimas,
  type Desfalque,
  type EstatisticasModelo,
  type ImpactoSugerido,
  type LeituraFlashscore,
  type LeituraStats,
  type LinhaClassificacao,
  type ProblemaLinha,
  type ResumoUltimas,
  type StatusEscalacao,
  type TabelaConsolidada,
} from '@pe/parsers';
import { FATOR_DESFALQUE, inicioIso, num, ROTULO_DESFALQUE, type Rascunho } from './estado';

export interface EscalacaoTime {
  titulares: string[];
  reservas: string[];
  formacao?: string;
  tecnico?: string;
  origem: 'print' | 'manual' | 'vazio';
}

export interface EscalacaoDerivada {
  casa: EscalacaoTime;
  fora: EscalacaoTime;
  status?: StatusEscalacao;
  avisos: string[];
  /** os dois times com 9+ titulares: conta como "escalação conferida" (DQ A) */
  conferida: boolean;
  /** só provável: o gate sobe (+1 pp) e o modelo pesa menos */
  incerta: boolean;
}

export interface Derivado {
  sofa: LeituraStats | null;
  sup: LeituraStats | null;
  tabela: TabelaConsolidada;
  modeloCasa: EstatisticasModelo;
  modeloFora: EstatisticasModelo;
  lambda: ResultadoLambdaModelo | null;
  /** λ de escanteios/cartões (nível 3), quando os dois times têm o dado */
  contagens: Partial<Record<Estatistica, ResultadoLambdaContagem>>;
  desfalques: Desfalque[];
  avisosDesfalques: string[];
  escalacao: EscalacaoDerivada;
  /** últimas partidas de cada time: sequência, casa/fora e gols */
  ultimas: Record<'casa' | 'fora', ResumoUltimas | null>;
  impacto: Record<'casa' | 'fora', ImpactoSugerido>;
  classificacao: LinhaClassificacao[];
  avisosClassificacao: string[];
  flash: LeituraFlashscore | null;
  dq: { dq: DQ; motivos: string[] };
  destaques: string[];
  problemasOdds: ProblemaLinha[];
  errosOdds: number;
  /** odds que entram no motor: as lidas menos as com erro (as com erro ficam de fora, não travam) */
  oddsValidas: LinhaOdd[];
  /** o que falta para a V4.0 (jogo + odds) */
  pendenciasV4: string[];
  /** o que falta para o motor de apoio V3.3 (estatísticas) */
  pendencias: string[];
  v4: ResultadoV4 | null;
  movimentos: Movimento[];
  atrasos: Atraso[];
  /** travas da banca recebidas do histórico (só repassadas para a tela) */
  travas?: TravasBanca;
  resultado: ResultadoAnalise | null;
  relatorio: Relatorio | null;
}

/**
 * Texto do Flashscore de verdade: nem marcado "sem texto", nem uma anotação curta ("não tem
 * texto"), que contaria como mais uma fonte de estatística sem dado nenhum.
 */
export function temTextoFlashscore(r: Rascunho): boolean {
  const t = r.flashscore.trim();
  return !r.flashscoreSemTexto && t.length >= 80;
}

const textos = (r: Rascunho, grupo: string) => (r.prints[grupo] ?? []).map((l) => l.texto);

export function derivar(r: Rascunho, travas?: TravasBanca): Derivado {
  const nomes = { casa: r.jogo.casa || 'Mandante', fora: r.jogo.fora || 'Visitante' };
  const temTimes = !!(r.jogo.casa && r.jogo.fora);

  const sofa = juntarLeiturasStats(
    textos(r, 'sofascore').map((t) => lerEstatisticas(t, 'sofascore', nomes)),
  );
  const sup = juntarLeiturasStats(
    textos(r, 'superscore').map((t) => lerEstatisticas(t, 'superscore', nomes)),
  );
  const tabela = consolidar({ sofascore: sofa, superscore: sup }, r.correcoes);
  const modeloCasa = estatisticasParaModelo(tabela, 'casa');
  const modeloFora = estatisticasParaModelo(tabela, 'fora');

  const desf = textos(r, 'desfalques').map((t) => lerDesfalques(t, nomes));
  const desfalques = desf.flatMap((d) => d.desfalques);
  const escalacao = derivarEscalacao(r, nomes, desfalques);
  const escalacaoIncerta = r.config.escalacaoIncerta || escalacao.incerta;
  const clas = textos(r, 'classificacao').map((t) => lerClassificacao(t, nomes));
  const flash = temTextoFlashscore(r) ? lerTextoFlashscore(r.flashscore, nomes) : null;

  // impacto dos desfalques: automático pelo texto do Flashscore, salvo escolha manual
  const impacto = {
    casa: avaliarImpactoDesfalques(desfalques, flash, 'casa'),
    fora: avaliarImpactoDesfalques(desfalques, flash, 'fora'),
  };

  // λ do modelo + ajustes de desfalque declarados
  let lambda: ResultadoLambdaModelo | null = null;
  if (modeloCasa.stats && modeloFora.stats) {
    const ajustes: AjusteLambda[] = [];
    for (const t of ['casa', 'fora'] as const) {
      const outro = t === 'casa' ? 'fora' : 'casa';
      const escolhido = r.desfalqueAtaque[t];
      const at = escolhido === 'auto' ? impacto[t].nivel : escolhido;
      const df = r.desfalqueDefesa[t] === 'auto' ? 'nenhum' : r.desfalqueDefesa[t];
      if (at !== 'nenhum')
        ajustes.push({
          time: t,
          tipo: 'desfalque',
          fator: FATOR_DESFALQUE[at],
          descricao:
            escolhido === 'auto'
              ? `desfalques no ataque de ${nomes[t]} (automático): ${ROTULO_DESFALQUE[at]} — ${impacto[t].motivo}`
              : `desfalques no ataque de ${nomes[t]}: ${ROTULO_DESFALQUE[at]}`,
        });
      if (df !== 'nenhum')
        ajustes.push({
          time: outro,
          tipo: 'desfalque',
          fator: 1 / FATOR_DESFALQUE[df],
          descricao: `desfalques na defesa de ${nomes[t]} favorecem ${nomes[outro]}: ${ROTULO_DESFALQUE[df]}`,
        });
    }
    lambda = calcularLambdaModelo(modeloCasa.stats, modeloFora.stats, {
      mediaGolsPorTime: num(r.config.mediaGols),
      mando: num(r.config.mando),
      ajustes,
    });
  }

  // nível 3: escanteios e cartões amarelos, só com o dado dos dois times
  const contagens: Derivado['contagens'] = {};
  const mediaContagem = { escanteios: r.config.mediaEscanteios, cartoes: r.config.mediaCartoes };
  for (const e of ['escanteios', 'cartoes'] as const) {
    const c = estatisticasContagem(tabela, 'casa', e);
    const f = estatisticasContagem(tabela, 'fora', e);
    if (c && f) contagens[e] = calcularLambdaContagem(e, c, f, { media: num(mediaContagem[e]) });
  }
  const lambdasContagem: LambdasContagem = Object.fromEntries(
    Object.entries(contagens).map(([e, x]) => [e, x.lambdas]),
  );

  const desfalquesConhecidos =
    desfalques.length > 0 || !!flash?.trechos.some((t) => t.categoria === 'desfalques');
  const fontesStats = [
    sofa && Object.keys(sofa.campos).length,
    sup && Object.keys(sup.campos).length,
    flash,
  ].filter(Boolean).length;
  const dq = avaliarDQ({
    jogosMin:
      modeloCasa.stats && modeloFora.stats
        ? Math.min(modeloCasa.stats.jogos, modeloFora.stats.jogos)
        : null,
    temXg: modeloCasa.stats?.xg !== undefined && modeloFora.stats?.xg !== undefined,
    temChutes:
      modeloCasa.stats?.chutesNoAlvo !== undefined && modeloFora.stats?.chutesNoAlvo !== undefined,
    fontesStats,
    desfalquesConhecidos,
    ligaTop: r.config.ligaTop,
    escalacaoProvavel: r.config.escalacaoProvavel || escalacao.conferida,
  });

  const problemasOdds = checarSanidade(r.odds as LinhaOdd[]);
  const errosOdds = problemasOdds.filter((p) => p.nivel === 'erro').length;
  // uma linha com erro de leitura sai da análise; as outras seguem (antes 9 erros em 120 travavam tudo)
  const comErro = new Set(problemasOdds.filter((p) => p.nivel === 'erro').map((p) => p.indice));
  const oddsValidas = (r.odds as LinhaOdd[]).filter((_, i) => !comErro.has(i));

  const pendenciasV4: string[] = [];
  if (!temTimes) pendenciasV4.push('Jogo: preencher mandante e visitante');
  if (!r.jogo.hora) pendenciasV4.push('Jogo: preencher a hora do início');
  if (!r.odds.length) pendenciasV4.push('Odds: nenhuma odd lida ainda');
  if (r.odds.length && !oddsValidas.length)
    pendenciasV4.push(
      `Odds: todas as ${r.odds.length} com erro em vermelho; corrija na aba Mercado`,
    );
  const pendencias: string[] = [...pendenciasV4];
  for (const [t, m] of [
    ['casa', modeloCasa],
    ['fora', modeloFora],
  ] as const)
    if (!m.stats) pendencias.push(`Estatísticas de ${nomes[t]}: faltam ${m.faltando.join(', ')}`);

  let resultado: ResultadoAnalise | null = null;
  let relatorio: Relatorio | null = null;
  if (!pendencias.length && lambda) {
    const argumentos = r.redTeam.argumentos.map((a) => a.trim()).filter(Boolean);
    resultado = analisarJogo({
      jogo: { casa: r.jogo.casa, fora: r.jogo.fora, inicio: inicioIso(r) },
      dq: dq.dq,
      lambdaModelo: lambda.lambdas,
      lambdasContagem,
      linhas: oddsValidas,
      contexto: {
        favoritoLigaMaisForte: r.config.favoritoLigaMaisForte,
        escalacaoIncerta,
        mercadoMuitoLiquido: r.config.mercadoMuitoLiquido,
        priorNeutro: lambda.priorNeutro,
        explicacaoDivergencia: r.explicacaoDivergencia.trim() || undefined,
      },
      redTeam: argumentos.length || r.redTeam.sobreviveu ? { ...r.redTeam, argumentos } : undefined,
      banca: num(r.banca),
    });
    relatorio = gerarRelatorio({
      resultado,
      jogo: { casa: r.jogo.casa, fora: r.jogo.fora, competicao: r.jogo.competicao },
      destaquesStats: destaquesComparativos(tabela, nomes),
      contexto: flash?.trechos,
      desfalques,
      dqMotivos: dq.motivos,
    });
  }

  // V4.0: decisão contra a referência; o V3.3 entra como apoio quando há λ do modelo
  let v4: ResultadoV4 | null = null;
  if (!pendenciasV4.length) {
    const argumentos = r.redTeam.argumentos.map((a) => a.trim()).filter(Boolean);
    v4 = analisarV4({
      jogo: { casa: r.jogo.casa, fora: r.jogo.fora, inicio: inicioIso(r) },
      linhas: oddsValidas,
      ligaPrincipal: r.config.ligaTop,
      escalacaoIncerta,
      noticia: r.noticia,
      fatoNovo: r.explicacaoDivergencia.trim() || undefined,
      apoio: lambda
        ? {
            lambdas: resultado?.lambdaModelo.ajustado ?? lambda.lambdas,
            contagens: lambdasContagem,
            dq: dq.dq,
            w: pesoModelo(dq.dq, {
              mercadoMuitoLiquido: r.config.mercadoMuitoLiquido,
              escalacaoIncerta,
            }),
            jogosMin:
              modeloCasa.stats && modeloFora.stats
                ? Math.min(modeloCasa.stats.jogos, modeloFora.stats.jogos)
                : undefined,
            priorNeutro: lambda.priorNeutro,
            favoritoLigaMaisForte: r.config.favoritoLigaMaisForte,
          }
        : undefined,
      redTeam: argumentos.length || r.redTeam.sobreviveu ? { ...r.redTeam, argumentos } : undefined,
      banca: num(r.banca),
      travas,
    });
  }

  // movimento entre prints: cada print lido sozinho, com o seu horário
  const versoes = r.casas.flatMap((casa) =>
    (r.prints[`odds:${casa}`] ?? []).flatMap(
      (p) =>
        lerOddsCasa([p.texto], {
          jogo: nomes,
          data: r.jogo.data,
          fuso: '-03:00',
          casa,
          horarioPadrao: p.capturadoEm,
        }).linhas as LinhaOdd[],
    ),
  );
  const { movimentos, atrasos } = detectarMovimentos(versoes, nomes);

  return {
    sofa,
    sup,
    tabela,
    modeloCasa,
    modeloFora,
    lambda,
    contagens,
    desfalques,
    avisosDesfalques: desf.flatMap((d) => d.avisos),
    escalacao,
    ultimas: {
      casa: juntarUltimas(textos(r, 'ultimas:casa').map((t) => lerUltimas(t, nomes, 'casa'))),
      fora: juntarUltimas(textos(r, 'ultimas:fora').map((t) => lerUltimas(t, nomes, 'fora'))),
    },
    impacto,
    classificacao: clas.flatMap((c) => c.linhas),
    avisosClassificacao: clas.flatMap((c) => c.avisos),
    flash,
    dq,
    destaques: destaquesComparativos(tabela, nomes),
    problemasOdds,
    errosOdds,
    oddsValidas,
    pendenciasV4,
    pendencias,
    v4,
    movimentos,
    atrasos,
    travas,
    resultado,
    relatorio,
  };
}

/** Escalação: a lida dos prints, salvo o que você digitou à mão; cruza com os desfalques. */
function derivarEscalacao(
  r: Rascunho,
  nomes: { casa: string; fora: string },
  desfalques: Desfalque[],
): EscalacaoDerivada {
  const lida = juntarEscalacoes(textos(r, 'escalacao').map((t) => lerEscalacao(t, nomes)));
  const avisos = [...(lida?.avisos ?? [])];
  const time = (t: 'casa' | 'fora'): EscalacaoTime => {
    const manual = (r.escalacaoManual?.[t] ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const doPrint = lida?.[t];
    if (manual.length)
      return { ...doPrint, titulares: manual, reservas: doPrint?.reservas ?? [], origem: 'manual' };
    if (doPrint?.titulares.length) return { ...doPrint, origem: 'print' };
    return { titulares: [], reservas: [], origem: 'vazio' };
  };
  const casa = time('casa');
  const fora = time('fora');
  for (const [t, e] of [
    ['casa', casa],
    ['fora', fora],
  ] as const) {
    if (e.origem === 'print' && e.titulares.length > 11)
      avisos.push(
        `${nomes[t]}: ${e.titulares.length} titulares lidos (máx. 11) — confira e apague os que sobram`,
      );
    if (e.origem !== 'vazio' && e.titulares.length < 11)
      avisos.push(`${nomes[t]}: só ${e.titulares.length} titular(es) — falta nome na leitura`);
    for (const d of desfalques.filter((x) => x.time === t))
      if (e.titulares.some((n) => mesmoJogador(n, d.jogador)))
        avisos.push(
          `${d.jogador} (${nomes[t]}) está nos desfalques mas aparece como titular — conferir`,
        );
  }
  const status = r.statusEscalacao === 'auto' ? lida?.status : r.statusEscalacao;
  const conferida = casa.titulares.length >= 9 && fora.titulares.length >= 9;
  return { casa, fora, status, avisos, conferida, incerta: conferida && status === 'provavel' };
}
