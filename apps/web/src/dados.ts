/**
 * Tudo que o site mostra é DERIVADO do rascunho: textos lidos → parsers → cruzamento de
 * fontes → λ → DQ → motor → análise escrita. Nenhum número é decidido na tela.
 */
import {
  analisarJogo,
  avaliarDQ,
  calcularLambdaModelo,
  gerarRelatorio,
  type AjusteLambda,
  type DQ,
  type LinhaOdd,
  type Relatorio,
  type ResultadoAnalise,
  type ResultadoLambdaModelo,
} from '@pe/engine';
import {
  checarSanidade,
  consolidar,
  destaquesComparativos,
  estatisticasParaModelo,
  juntarLeiturasStats,
  lerClassificacao,
  lerDesfalques,
  lerEstatisticas,
  lerTextoFlashscore,
  type Desfalque,
  type EstatisticasModelo,
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
  desfalques: Desfalque[];
  avisosDesfalques: string[];
  classificacao: LinhaClassificacao[];
  avisosClassificacao: string[];
  flash: LeituraFlashscore | null;
  dq: { dq: DQ; motivos: string[] };
  destaques: string[];
  problemasOdds: ProblemaLinha[];
  errosOdds: number;
  pendencias: string[];
  resultado: ResultadoAnalise | null;
  relatorio: Relatorio | null;
}

const textos = (r: Rascunho, grupo: string) => (r.prints[grupo] ?? []).map((l) => l.texto);

export function derivar(r: Rascunho): Derivado {
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

  // λ do modelo + ajustes de desfalque declarados
  let lambda: ResultadoLambdaModelo | null = null;
  if (modeloCasa.stats && modeloFora.stats) {
    const ajustes: AjusteLambda[] = [];
    for (const t of ['casa', 'fora'] as const) {
      const outro = t === 'casa' ? 'fora' : 'casa';
      const at = r.desfalqueAtaque[t];
      const df = r.desfalqueDefesa[t];
      if (at !== 'nenhum')
        ajustes.push({
          time: t,
          tipo: 'desfalque',
          fator: FATOR_DESFALQUE[at],
          descricao: `desfalques no ataque de ${nomes[t]}: ${ROTULO_DESFALQUE[at]}`,
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

  const pendencias: string[] = [];
  if (!temTimes) pendencias.push('Jogo: preencher mandante e visitante');
  if (!r.jogo.hora) pendencias.push('Jogo: preencher a hora do início');
  for (const [t, m] of [
    ['casa', modeloCasa],
    ['fora', modeloFora],
  ] as const)
    if (!m.stats) pendencias.push(`Estatísticas de ${nomes[t]}: faltam ${m.faltando.join(', ')}`);
  if (!r.odds.length) pendencias.push('Odds: nenhuma odd lida ainda');
  if (errosOdds) pendencias.push(`Odds: ${errosOdds} erro(s) em vermelho para corrigir`);

  let resultado: ResultadoAnalise | null = null;
  let relatorio: Relatorio | null = null;
  if (!pendencias.length && lambda) {
    const argumentos = r.redTeam.argumentos.map((a) => a.trim()).filter(Boolean);
    resultado = analisarJogo({
      jogo: { casa: r.jogo.casa, fora: r.jogo.fora, inicio: inicioIso(r) },
      dq: dq.dq,
      lambdaModelo: lambda.lambdas,
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

  return {
    sofa,
    sup,
    tabela,
    modeloCasa,
    modeloFora,
    lambda,
    desfalques,
    avisosDesfalques: desf.flatMap((d) => d.avisos),
    classificacao: clas.flatMap((c) => c.linhas),
    avisosClassificacao: clas.flatMap((c) => c.avisos),
    flash,
    dq,
    destaques: destaquesComparativos(tabela, nomes),
    problemasOdds,
    errosOdds,
    pendencias,
    resultado,
    relatorio,
  };
}
