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
  juntarLeiturasStats,
  lerOddsCasa,
  lerClassificacao,
  lerDesfalques,
  lerEstatisticas,
  lerTextoFlashscore,
  type Desfalque,
  type EstatisticasModelo,
  type ImpactoSugerido,
  type LeituraFlashscore,
  type LeituraStats,
  type LinhaClassificacao,
  type ProblemaLinha,
  type TabelaConsolidada,
} from '@pe/parsers';
import { FATOR_DESFALQUE, inicioIso, num, ROTULO_DESFALQUE, type Rascunho } from './estado';

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
  impacto: Record<'casa' | 'fora', ImpactoSugerido>;
  classificacao: LinhaClassificacao[];
  avisosClassificacao: string[];
  flash: LeituraFlashscore | null;
  dq: { dq: DQ; motivos: string[] };
  destaques: string[];
  problemasOdds: ProblemaLinha[];
  errosOdds: number;
  /** o que falta para a V4.0 (jogo + odds) */
  pendenciasV4: string[];
  /** o que falta para o motor de apoio V3.3 (estatísticas) */
  pendencias: string[];
  v4: ResultadoV4 | null;
  movimentos: Movimento[];
  atrasos: Atraso[];
  resultado: ResultadoAnalise | null;
  relatorio: Relatorio | null;
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
  const clas = textos(r, 'classificacao').map((t) => lerClassificacao(t, nomes));
  const flash = r.flashscore.trim() ? lerTextoFlashscore(r.flashscore, nomes) : null;

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
    escalacaoProvavel: r.config.escalacaoProvavel,
  });

  const problemasOdds = checarSanidade(r.odds as LinhaOdd[]);
  const errosOdds = problemasOdds.filter((p) => p.nivel === 'erro').length;

  const pendenciasV4: string[] = [];
  if (!temTimes) pendenciasV4.push('Jogo: preencher mandante e visitante');
  if (!r.jogo.hora) pendenciasV4.push('Jogo: preencher a hora do início');
  if (!r.odds.length) pendenciasV4.push('Odds: nenhuma odd lida ainda');
  if (errosOdds) pendenciasV4.push(`Odds: ${errosOdds} erro(s) em vermelho para corrigir`);
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
      linhas: r.odds as LinhaOdd[],
      contexto: {
        favoritoLigaMaisForte: r.config.favoritoLigaMaisForte,
        escalacaoIncerta: r.config.escalacaoIncerta,
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
      linhas: r.odds as LinhaOdd[],
      ligaPrincipal: r.config.ligaTop,
      escalacaoIncerta: r.config.escalacaoIncerta,
      noticia: r.noticia,
      fatoNovo: r.explicacaoDivergencia.trim() || undefined,
      apoio: lambda
        ? {
            lambdas: resultado?.lambdaModelo.ajustado ?? lambda.lambdas,
            contagens: lambdasContagem,
            dq: dq.dq,
            w: pesoModelo(dq.dq, {
              mercadoMuitoLiquido: r.config.mercadoMuitoLiquido,
              escalacaoIncerta: r.config.escalacaoIncerta,
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
    impacto,
    classificacao: clas.flatMap((c) => c.linhas),
    avisosClassificacao: clas.flatMap((c) => c.avisos),
    flash,
    dq,
    destaques: destaquesComparativos(tabela, nomes),
    problemasOdds,
    errosOdds,
    pendenciasV4,
    pendencias,
    v4,
    movimentos,
    atrasos,
    resultado,
    relatorio,
  };
}
