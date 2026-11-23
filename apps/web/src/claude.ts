/**
 * Prompt de análise pré-live (A1–A4) para colar no chat do Claude. Não chama API nenhuma: só gera
 * texto para a área de transferência.
 *
 * O prompt INTERPRETA e QUESTIONA a análise do motor: não calcula probabilidade nova e não muda
 * EV, stake nem decisão. Todo número vem do que o motor já calculou (Derivado). A única conta
 * feita aqui é DESCRITIVA (preço justo por operador e amplitude entre operadores), com a mesma
 * função e a mesma opção de remoção de margem da V4 (precificar com devig3 'shin'); ela não entra
 * em nenhum cálculo nem decisão. Campo ausente vira DADO INDISPONÍVEL / ORIGEM INDISPONÍVEL.
 */
import {
  criarLiquidador,
  DISPERSAO,
  mediana,
  minutos,
  NOME_ESTATISTICA,
  NOMES_REFERENCIA,
  precificar,
  resolverCasa,
  JANELA_COMPARAVEL_MIN,
  W_MAX_NIVEL3,
  type AvaliacaoV4,
  type Liquidador,
  type PrecoCasa,
} from '@pe/engine';
import { CAMPOS_STATS, type CampoStat } from '@pe/parsers';
import { temTextoFlashscore, type Derivado } from './dados';
import type { Rascunho } from './estado';

export const INDISPONIVEL = 'DADO INDISPONÍVEL';
export const ORIGEM_INDISPONIVEL = 'ORIGEM INDISPONÍVEL';
/** operadores distintos exigidos para exibir a amplitude */
export const MIN_OPERADORES_AMPLITUDE = 3;

/** Campos da tabela que entram no cálculo (λ de gols e λ de escanteios/cartões). */
export const CAMPOS_DO_MODELO: ReadonlySet<CampoStat> = new Set<CampoStat>([
  'partidas',
  'golsMarcados',
  'golsSofridos',
  'golsPorJogo',
  'golsSofridosPorJogo',
  'xg',
  'chutesNoAlvo',
  'grandesChances',
  'defesasGoleiro',
  'escanteios',
  'escanteiosContra',
  'cartoesAmarelos',
]);

/** Odd sempre em cotação decimal (1,85); probabilidade e acerto mínimo em %. */
export const oddDecimal = (x: number) => x.toFixed(2).replace('.', ',');
export const pct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
const num = (x: number) => String(Number(x.toFixed(2))).replace('.', ',');
const hora = (iso?: string) => (iso ? iso.slice(11, 16) || iso : 'sem horário');

/* ---------- preço justo por casa e amplitude entre operadores (descritivo) ---------- */

export interface PrecoDaCasa {
  /** nome de exibição da marca (casa) */
  casa: string;
  /** identidade do operador (resolverCasa): marcas do mesmo operador têm o mesmo */
  operatorId: string;
  pJusta: number;
  horarioColeta?: string;
  /** dentro da janela de 10 min da melhor odd; null quando não dá para saber */
  naJanela: boolean | null;
}

export interface PrecoOperador {
  /** o operador, pelas marcas dele que entraram (ex.: "Betsul/CasaDeApostas") */
  operador: string;
  operatorId: string;
  /** mediana das marcas do operador DENTRO da janela (um voto por operador, como na V4) */
  pJusta: number;
}

export type Amplitude =
  | {
      disponivel: true;
      casas: PrecoDaCasa[];
      operadores: PrecoOperador[];
      minimo: number;
      maximo: number;
      /** marcas fora da janela, excluídas da mediana do próprio operador */
      excluidas: string[];
      /** onde o preço da melhor odd fica em relação aos OUTROS operadores; null = indisponível */
      posicaoMelhor: 'dentro' | 'abaixo' | 'acima' | null;
      motivoPosicao?: string;
    }
  | { disponivel: false; casas: PrecoDaCasa[]; motivo: string };

/**
 * Preço justo de cada casa e amplitude entre operadores de um candidato da V4. Descritivo: só
 * exibe o que `precificar` (a mesma da V4, com devig3 'shin') produz para as odds aprovadas.
 * Amplitude só com: mercado completo (só esses saem de precificar), todas as cotações com
 * horário, a janela de 10 min aplicada a CADA cotação (marca fora da janela não entra na mediana
 * do operador), todo operador com ao menos uma cotação na janela, 3+ operadores. Operadores pela
 * identidade real (operatorId), nunca pelo nome de exibição. Senão: indisponível.
 */
export function amplitudeDoCandidato(d: Derivado, a: AvaliacaoV4): Amplitude {
  const selecao = precificar(d.oddsValidas, { devig3: 'shin' }).selecoes.find(
    (s) => s.chave === a.chave,
  );
  if (!selecao)
    return {
      disponivel: false,
      casas: [],
      motivo: 'sem preços completos por operador para esta seleção',
    };
  const janela = (p: PrecoCasa): boolean | null =>
    !p.horarioColeta || !a.horarioColeta
      ? null
      : (minutos(p.horarioColeta, a.horarioColeta) ?? Infinity) <= JANELA_COMPARAVEL_MIN;
  const casas: PrecoDaCasa[] = selecao.precos.map((p) => {
    const id = resolverCasa(p.casa);
    return {
      casa: id.displayName,
      operatorId: id.operatorId,
      pJusta: p.pJusta,
      horarioColeta: p.horarioColeta,
      naJanela: janela(p),
    };
  });
  const indisponivel = (motivo: string): Amplitude => ({ disponivel: false, casas, motivo });
  const semHorario = casas.filter((c) => !c.horarioColeta);
  if (semHorario.length)
    return indisponivel(`sem horário de coleta: ${semHorario.map((c) => c.casa).join(', ')}`);
  if (!a.horarioColeta) return indisponivel('a melhor odd não tem horário de coleta');

  // a janela vale para CADA cotação; o operador entra com as marcas dele que estão na janela
  const porOperador = new Map<string, PrecoDaCasa[]>();
  for (const c of casas)
    porOperador.set(c.operatorId, [...(porOperador.get(c.operatorId) ?? []), c]);
  const todoFora = [...porOperador.values()].filter((cs) => cs.every((c) => !c.naJanela));
  if (todoFora.length)
    return indisponivel(
      `coletados a mais de ${JANELA_COMPARAVEL_MIN} min da melhor odd: ${todoFora
        .map((cs) => cs.map((c) => c.casa).join('/'))
        .join(', ')}`,
    );
  const operadores: PrecoOperador[] = [...porOperador.entries()].map(([operatorId, cs]) => {
    const dentro = cs.filter((c) => c.naJanela);
    return {
      operador: dentro.map((c) => c.casa).join('/'),
      operatorId,
      pJusta: mediana(dentro.map((c) => c.pJusta)),
    };
  });
  if (operadores.length < MIN_OPERADORES_AMPLITUDE)
    return indisponivel(
      `só ${operadores.length} operador(es) com o mercado completo (exige ${MIN_OPERADORES_AMPLITUDE})`,
    );
  const ps = operadores.map((o) => o.pJusta);
  const excluidas = casas.filter((c) => !c.naJanela).map((c) => c.casa);
  const base = {
    disponivel: true as const,
    casas,
    operadores,
    minimo: Math.min(...ps),
    maximo: Math.max(...ps),
    excluidas,
  };

  // posição: o preço da melhor odd contra os OUTROS operadores (o dela fica de fora da faixa)
  const semPosicao = (motivoPosicao: string): Amplitude => ({
    ...base,
    posicaoMelhor: null,
    motivoPosicao,
  });
  const idMelhor = resolverCasa(a.casaMelhorOdd);
  if (!idMelhor.mapeada)
    return semPosicao(
      `a casa da melhor odd (${a.casaMelhorOdd}) não está no registro de operadores`,
    );
  const precoMelhor = selecao.precos.find(
    (p) => p.casa === a.casaMelhorOdd && p.odd === a.melhorOdd,
  );
  if (!precoMelhor || resolverCasa(precoMelhor.casa).operatorId !== idMelhor.operatorId)
    return semPosicao('a cotação da melhor odd não foi identificada entre os preços');
  const outras = operadores
    .filter((o) => o.operatorId !== idMelhor.operatorId)
    .map((o) => o.pJusta);
  if (outras.length < MIN_OPERADORES_AMPLITUDE - 1)
    return semPosicao(`só ${outras.length} outro(s) operador(es) para comparar`);
  return {
    ...base,
    posicaoMelhor:
      precoMelhor.pJusta < Math.min(...outras)
        ? 'abaixo'
        : precoMelhor.pJusta > Math.max(...outras)
          ? 'acima'
          : 'dentro',
  };
}

/* ---------- origem do P_modelo: qual modelo e qual λ o motor usou ---------- */

export type EstadoLambda =
  /** motivo só quando comprovado por um campo do resultado; null = motivo indisponível */
  | { tipo: 'nao-executada'; motivo: string | null }
  | { tipo: 'sem-ajuste' }
  | { tipo: 'ajustes'; itens: ('9.4' | '16.3' | 'divergencia-mantida')[] }
  | { tipo: 'indisponivel' };

/** Prefixos exatos que ajustarLambdaModelo (motor) escreve em `ajustes`. */
const PREFIXOS_AJUSTE: [string, '9.4' | '16.3' | 'divergencia-mantida'][] = [
  ['16.3 viés conhecido:', '16.3'],
  ['9.4: divergência mantida por fato concreto:', 'divergencia-mantida'],
  ['9.4: λ_modelo movido em direção ao λ_market', '9.4'],
];

const mesmoLambda = (x: { casa: number; fora: number }, y: { casa: number; fora: number }) =>
  x.casa === y.casa && x.fora === y.fora;

/** Motivo que analisarJogo (decisao.ts) grava na única saída EXCLUIDO (checagem pré-live). */
const MOTIVO_EXCLUIDO_MOTOR = 'jogo iniciado ou encerrado: somente pré-live';
/** Prefixo que analisarJogo grava em dq.motivos quando ajustarLambdaMercado devolve erro. */
const PREFIXO_SEM_LAMBDA_MERCADO = 'sem base de mercado para λ: ';

/**
 * O que aconteceu com o λ de gols entre o modelo e o apoio da V4 (9.4 e 16.3, em
 * ajustarLambdaModelo). A causa de uma etapa não executada só é dita quando um campo do resultado
 * a comprova; senão, motivo indisponível. Texto que não se reconhece: indisponível.
 */
export function estadoDoLambda(d: Derivado): EstadoLambda {
  if (!d.lambda) return { tipo: 'indisponivel' };
  // dados.ts só roda analisarJogo com λ e SEM pendências: com λ presente, faltar o resultado
  // é pendência — e as pendências estão em d.pendencias
  if (!d.resultado)
    return {
      tipo: 'nao-executada',
      motivo: d.pendencias.length
        ? `a análise de apoio não rodou; pendências: ${d.pendencias.join('; ')}`
        : null,
    };
  const lm = d.resultado.lambdaModelo;
  // EXCLUIDO sai antes de calcular o λ do mercado; a causa vem do motivo gravado pelo motor
  if (d.resultado.decisao === 'EXCLUIDO')
    return mesmoLambda(lm.ajustado, lm.original)
      ? {
          tipo: 'nao-executada',
          motivo: d.resultado.motivos.includes(MOTIVO_EXCLUIDO_MOTOR)
            ? 'jogo iniciado ou encerrado (a análise de apoio só roda pré-live)'
            : null,
        }
      : { tipo: 'indisponivel' };
  // sem λ do mercado: a causa é o erro de ajustarLambdaMercado, gravado em dq.motivos
  if (!d.resultado.lambdaMercado) {
    const gravado = d.resultado.dq.motivos.find((m) => m.startsWith(PREFIXO_SEM_LAMBDA_MERCADO));
    return mesmoLambda(lm.ajustado, lm.original)
      ? {
          tipo: 'nao-executada',
          motivo: gravado
            ? `o motor não ajustou o λ do mercado: "${gravado.slice(PREFIXO_SEM_LAMBDA_MERCADO.length)}"`
            : null,
        }
      : { tipo: 'indisponivel' };
  }
  if (!lm.ajustes.length)
    return mesmoLambda(lm.ajustado, lm.original)
      ? { tipo: 'sem-ajuste' }
      : { tipo: 'indisponivel' };
  const itens: ('9.4' | '16.3' | 'divergencia-mantida')[] = [];
  for (const texto of lm.ajustes) {
    const achado = PREFIXOS_AJUSTE.find(([p]) => texto.startsWith(p));
    if (!achado) return { tipo: 'indisponivel' };
    itens.push(achado[1]);
  }
  // só "divergência mantida" não move o λ: se moveu, a leitura não confere
  if (itens.every((i) => i === 'divergencia-mantida') && !mesmoLambda(lm.ajustado, lm.original))
    return { tipo: 'indisponivel' };
  return { tipo: 'ajustes', itens };
}

/** O λ de gols, em palavras, conforme estadoDoLambda. */
export function descricaoLambda(d: Derivado): string {
  const e = estadoDoLambda(d);
  if (e.tipo === 'indisponivel') return `λ de origem ${ORIGEM_INDISPONIVEL}`;
  if (e.tipo === 'nao-executada')
    return e.motivo
      ? `λ bruto do modelo (checagem 9.4 NÃO executada: ${e.motivo})`
      : `λ bruto do modelo (checagem 9.4 NÃO executada; motivo ${INDISPONIVEL})`;
  if (e.tipo === 'sem-ajuste') return 'λ do modelo (checagem 9.4 executada, sem ajuste)';
  const frases = e.itens.map((i) =>
    i === '9.4'
      ? 'λ movido em direção ao λ do mercado pela regra 9.4'
      : i === '16.3'
        ? 'supremacia trocada pela do mercado pela regra 16.3 (total do modelo mantido)'
        : 'divergência com o λ do mercado mantida por fato concreto (9.4, sem mover o λ)',
  );
  return `λ do modelo com: ${frases.join('; ')}`;
}

/**
 * Origem do P_modelo de uma seleção: o modelo que o motor usa para ESTE tipo de mercado
 * (distribuicaoModelo em mercados.ts) e o λ dele. Sem liquidador ou sem o λ: indisponível.
 */
export function origemPModelo(d: Derivado, liq: Liquidador | null): string {
  if (!liq) return ORIGEM_INDISPONIVEL;
  // contagem: matrizContagem (contagens.ts) = binomial negativa por time, times independentes
  if (liq.tipo === 'contagem' || liq.tipo === 'primeira_contagem') {
    const c = d.contagens[liq.estatistica];
    if (!c) return ORIGEM_INDISPONIVEL;
    const nb = `binomial negativa por time, times independentes, variância = ${num(DISPERSAO[liq.estatistica])} × média`;
    const lambdas = `λ de ${NOME_ESTATISTICA[liq.estatistica]} ${num(c.lambdas.casa)} × ${num(c.lambdas.fora)}, sem checagem contra o mercado`;
    if (liq.tipo === 'primeira_contagem')
      return `modelo de contagem (${nb}): chance de nenhum = P(0 × 0) da matriz do jogo todo; havendo, divisão proporcional aos λ; sem nenhum, aposta em mandante ou visitante é devolvida (${lambdas})`;
    return `modelo de contagem (${nb}${liq.periodo === '1T' ? '; λ × fração do 1º tempo' : ''}; ${lambdas})`;
  }
  if (!d.lambda) return ORIGEM_INDISPONIVEL;
  const lambda = descricaoLambda(d);
  // placar: matriz ft (matrizPlacares com ρ, Dixon-Coles) ou t1/t2 (ρ = 0, λ × fração do tempo)
  if (liq.tipo === 'placar' && liq.periodo === 'FT')
    return `Poisson com ajuste Dixon-Coles (jogo todo), ${lambda}`;
  if (liq.tipo === 'placar')
    return `Poisson independente do ${liq.periodo === '1T' ? '1º' : '2º'} tempo (sem Dixon-Coles; λ do jogo × ${liq.periodo === '1T' ? 'fração do 1º tempo' : '(1 − fração do 1º tempo)'}), ${lambda}`;
  if (liq.tipo === 'tempos')
    return `Poisson independente por tempo (sem Dixon-Coles; λ do jogo × fração de cada tempo; 1º e 2º combinados), ${lambda}`;
  // sequência (1º e último gol): ft[0][0] da matriz Dixon-Coles e divisão pelos λ (mercados.ts)
  if (liq.tipo === 'sequencia')
    return `chance de nenhum gol = P(0-0) da matriz Dixon-Coles do jogo todo; havendo gol, divisão proporcional aos λ (λ do time ÷ soma dos λ), a mesma para o 1º e o último gol; o Dixon-Coles entra só no 0-0, ${lambda}`;
  return ORIGEM_INDISPONIVEL;
}

/* ---------- texto ---------- */

const REGRAS = [
  'PAPEL',
  'Você é um analista quantitativo pré-live. Sua função é INTERPRETAR e QUESTIONAR a análise de um motor determinístico. Você não calcula probabilidades novas e não altera EV, stake nem decisão.',
  '',
  'REGRAS',
  '1. A decisão oficial é a da V4.0. Você pode discordar e explicar, mas não a substitui. NO BET é resultado legítimo e frequente.',
  '2. Valor só existe quando uma casa paga ACIMA do preço justo da referência. Estatística boa não é valor: se o mercado já precifica, não há vantagem.',
  '3. Só as estatísticas de "ENTRADAS DO MODELO" afetam o cálculo. As do "CONTEXTO" NUNCA justificam valor; só apontam risco ou reduzem confiança.',
  '4. A lista "Melhores entradas" é EXCLUSIVAMENTE INFORMATIVA: ordena por chance de green, não por valor, não tem o rigor da V4 e NÃO é recomendação de aposta nem de stake, mesmo que o sistema mostre stake.',
  '5. O filtro de discordância do modelo está INATIVO no sistema (prior neutro). A opinião do modelo é um sinal fraco de um modelo não calibrado.',
  `6. Cada probabilidade traz a sua origem exata. Use SÓ a origem informada. Diante de "${ORIGEM_INDISPONIVEL}" ou "${INDISPONIVEL}", repita isso: não estime, não deduza, não complete.`,
  '7. A faixa de ±10% do λ é um parâmetro fixo do sistema, NÃO um intervalo de confiança.',
  '8. Unidades: odd sempre em cotação decimal (ex.: 1,85); probabilidade e acerto mínimo em %.',
  '9. Não invente dado, odd, lesão ou número. Se faltar, diga que falta e o que mudaria se existisse.',
];

const PEDIDO = [
  'PEDIDO DE ANÁLISE (nesta ordem)',
  '1. Veredito sobre a decisão V4: concorda ou discorda, e por quê, em até 3 linhas.',
  '2. Origem da vantagem, usando só as origens informadas.',
  `3. Checklist de falso positivo (SIM / NÃO / ${INDISPONIVEL}):`,
  '   a) o EV depende de uma única casa fora da faixa das outras?',
  '   b) a diferença de horário entre a coleta e a referência pode explicar o preço?',
  '   c) há notícia que a referência pode já ter e as estatísticas não?',
  '   d) a amostra é curta ou mistura temporadas e competições?',
  '   e) a tese usa alguma estatística do CONTEXTO como argumento de valor?',
  '   f) é mercado de nicho com preço vindo do modelo?',
  '4. Incerteza: como a conclusão muda se o λ estiver 15 a 20% errado (a faixa de ±10% é parâmetro, não medida).',
  '5. O que teria que ser verdade para existir valor real, e quão plausível é isso.',
  '6. Red team: 3 argumentos contra, um atacando a premissa do modelo e outro atacando a referência de preço.',
  '7. Conclusão em 3 linhas. Sem vantagem comprovada: NO BET, sem rodeio.',
];

/** Texto da amplitude de um candidato (seção 2). */
function linhasAmplitude(amp: Amplitude): string[] {
  const casas = amp.casas.length
    ? amp.casas
        .map(
          (c) =>
            `${c.casa}: ${pct(c.pJusta)} (${hora(c.horarioColeta)}${c.naJanela === false ? ', fora da janela' : ''})`,
        )
        .join('; ')
    : `${INDISPONIVEL} (sem preços completos por operador para esta seleção)`;
  if (!amp.disponivel)
    return [
      `  · Preço justo por casa: ${casas}`,
      `  · Amplitude entre operadores [descritivo, não entra na decisão]: ${INDISPONIVEL} (${amp.motivo})`,
    ];
  const posicao =
    amp.posicaoMelhor === null
      ? `posição da melhor odd: ${INDISPONIVEL} (${amp.motivoPosicao})`
      : `a melhor odd está ${
          amp.posicaoMelhor === 'dentro'
            ? 'dentro da faixa dos outros operadores'
            : amp.posicaoMelhor === 'abaixo'
              ? 'ABAIXO da faixa dos outros operadores (preço isolado)'
              : 'acima da faixa dos outros operadores'
        }`;
  return [
    `  · Preço justo por casa: ${casas}`,
    `  · Por operador (mediana das marcas na janela): ${amp.operadores.map((o) => `${o.operador}: ${pct(o.pJusta)}`).join('; ')}`,
    `  · Amplitude entre operadores [descritivo, não entra na decisão]: ${pct(amp.minimo)} a ${pct(amp.maximo)}; ${posicao}${
      amp.excluidas.length
        ? ` · fora da janela de ${JANELA_COMPARAVEL_MIN} min, excluídas da mediana: ${amp.excluidas.join(', ')}`
        : ''
    }`,
  ];
}

/** Peso do modelo na mistura da lista: o teto de 0,30 vale em escanteios e cartões (nível 3). */
function descricaoPeso(d: Derivado, nivel: 1 | 2 | 3 | null): string {
  if (nivel === null) return `w: ${ORIGEM_INDISPONIVEL}`;
  return nivel === 3
    ? `w = o menor entre o peso pela DQ ${d.dq.dq} e ${num(W_MAX_NIVEL3)} (teto de escanteios e cartões)`
    : `w = peso pela DQ ${d.dq.dq}`;
}

export function montarPromptClaude(r: Rascunho, d: Derivado): string {
  const nomes = { casa: r.jogo.casa || 'Mandante', fora: r.jogo.fora || 'Visitante' };
  const sem = (t: string) => t.replace('Ganha se: ', '');
  const l: string[] = [
    ...REGRAS,
    '',
    `# Jogo: ${nomes.casa} × ${nomes.fora}`,
    `${r.jogo.competicao} · ${r.jogo.data} ${r.jogo.hora}`,
  ];

  // 1 · decisão oficial
  l.push('', '1 · DECISÃO OFICIAL V4.0');
  const v4 = d.v4;
  if (!v4) {
    l.push(
      `- Decisão: ${INDISPONIVEL} (pendências: ${d.pendenciasV4.join('; ') || 'não informadas'})`,
    );
  } else {
    l.push(
      `- Decisão: ${v4.rotulo} · referência ${v4.referencia.nivel}: ${NOMES_REFERENCIA[v4.referencia.nivel]}`,
      `- Motivos: ${v4.motivos.join(' | ') || 'nenhum'} · Avisos: ${v4.avisos.join(' | ') || 'nenhum'}`,
    );
    if (!v4.top5.length) l.push('- Nenhum candidato avaliado.');
    for (const a of v4.top5)
      l.push(
        `- ${sem(a.descricao)} @ ${oddDecimal(a.melhorOdd)} (${a.casaMelhorOdd})`,
        `  · P_true ${pct(a.pTrue)} — origem: ${a.fonteP?.trim() || ORIGEM_INDISPONIVEL}`,
        `  · odd justa ${oddDecimal(a.oddJusta)} · EV ${pct(a.ev)} contra gate ${a.evMinimo === null ? `${INDISPONIVEL} (sem gate: ${a.nivel})` : pct(a.evMinimo)} · odd mínima ${a.oddMinima === null ? INDISPONIVEL : oddDecimal(a.oddMinima)}`,
        `  · coleta ${hora(a.horarioColeta)} · referência ${hora(a.horarioReferencia)}`,
        `  · casas com preço nesta seleção: ${a.casas} · margem da referência ${pct(a.margemReferencia)}`,
      );
  }

  // 2 · origem da vantagem
  l.push('', '2 · ORIGEM DA VANTAGEM (candidatos com EV > 0)');
  const positivos = v4?.top5.filter((a) => a.ev > 0) ?? [];
  if (!positivos.length) l.push('- Nenhum candidato com EV > 0.');
  for (const a of positivos)
    l.push(
      `- ${sem(a.descricao)} @ ${oddDecimal(a.melhorOdd)} (${a.casaMelhorOdd})`,
      `  · Tipo: ${a.nivel === 'R3' ? 'modelo × preço (R3)' : `preço × preço (${a.nivel})`}`,
      ...linhasAmplitude(amplitudeDoCandidato(d, a)),
      `  · P_consenso ${pct(a.pConsenso)} — origem: mediana das casas sem margem (inclui a casa da melhor odd)`,
      a.pModelo === null
        ? `  · P_modelo: ${INDISPONIVEL} (sem modelo para este mercado)`
        : `  · P_modelo ${pct(a.pModelo)} — origem: ${origemPModelo(d, a.liq)} → ${a.filtro} (filtro inativo)`,
    );

  // 3 · entradas do modelo
  l.push('', '3 · ENTRADAS DO MODELO (só estas entram no cálculo)');
  const nJogos = (t: 'casa' | 'fora') => {
    const m = t === 'casa' ? d.modeloCasa : d.modeloFora;
    return m.stats ? String(m.stats.jogos) : INDISPONIVEL;
  };
  l.push(
    `- Amostra: ${nJogos('casa')} jogos de ${nomes.casa} e ${nJogos('fora')} de ${nomes.fora}`,
    '- Período e competição: NÃO INFORMADO (não há campo estruturado; o cabeçalho do print não é interpretado)',
  );
  const linhaStat = (campo: CampoStat, rotulo: string) => {
    const v = d.tabela[campo];
    if (!v) return null;
    const f = (x?: number) => (x === undefined ? '?' : num(x));
    const div = (['casa', 'fora'] as const)
      .filter((t) => v[t].divergente)
      .map(
        (t) =>
          `${nomes[t]}: SofaScore ${f(v[t].porFonte.sofascore)} × SuperScore ${f(v[t].porFonte.superscore)}, usado ${v[t].fonte}`,
      );
    return `- ${rotulo}: ${nomes.casa} ${f(v.casa.valor)} × ${f(v.fora.valor)} ${nomes.fora}${div.length ? ` (fontes divergem — ${div.join('; ')})` : ''}`;
  };
  const doModelo = CAMPOS_STATS.filter((c) => CAMPOS_DO_MODELO.has(c.campo))
    .map((c) => linhaStat(c.campo, c.rotulo))
    .filter((x): x is string => !!x);
  l.push(...(doModelo.length ? doModelo : [`- Estatísticas do modelo: ${INDISPONIVEL}`]));
  for (const [t, m] of [
    ['casa', d.modeloCasa],
    ['fora', d.modeloFora],
  ] as const)
    if (m.stats && m.stats.chutesNoAlvoContra !== undefined)
      l.push(
        `- Chutes no alvo sofridos de ${nomes[t]} (derivado: defesas + gols sofridos): ${num(m.stats.chutesNoAlvoContra)}`,
      );
  if (d.lambda) {
    l.push(`- Método: ${d.lambda.declaracoes.join(' · ')}`);
    const apoio = d.resultado?.lambdaModelo.ajustado;
    l.push(
      `- λ bruto: ${num(d.lambda.lambdas.casa)} × ${num(d.lambda.lambdas.fora)} · λ usado pelo apoio da V4: ${
        apoio ? `${num(apoio.casa)} × ${num(apoio.fora)}` : 'o λ bruto'
      } · origem: ${descricaoLambda(d)}`,
    );
  } else l.push(`- λ do modelo: ${INDISPONIVEL} (faltam estatísticas mínimas)`);
  const aplicados = d.lambda?.declaracoes.filter((x) => x.startsWith('desfalque')) ?? [];
  l.push(`- Desfalques aplicados: ${aplicados.length ? aplicados.join(' · ') : 'nenhum'}`);
  for (const e of ['escanteios', 'cartoes'] as const) {
    const c = d.contagens[e];
    l.push(
      `- ${e === 'escanteios' ? 'Escanteios' : 'Cartões amarelos'}: ${
        c ? `λ ${num(c.lambdas.casa)} × ${num(c.lambdas.fora)}` : INDISPONIVEL
      }`,
    );
  }

  // 4 · incerteza e qualidade
  l.push(
    '',
    '4 · INCERTEZA E QUALIDADE',
    `- DQ das estatísticas (a que a V4 usa): ${d.dq.dq} · motivos: ${d.dq.motivos.join('; ') || 'nenhum'}`,
    `- DQ final do relatório (limitada pelas odds): ${d.dqFinal.dq} · motivos: ${d.dqFinal.motivos.join('; ') || 'nenhum'}`,
    '- Faixa de ±10% no λ: parâmetro fixo do sistema; NÃO é intervalo de confiança nem incerteza estimada pela amostra',
    `- Sensibilidade: ${
      v4?.sensibilidade
        ? `${v4.sensibilidade.classe} (${v4.sensibilidade.positivos} de ${v4.sensibilidade.cenarios.length} cenários com EV > 0)`
        : 'não calculada (só existe em R3)'
    }`,
  );
  // limitação declarada (P5): o motor só registra o resultado do teste como texto em stake.ajustes
  const fragil = v4?.melhor?.stake?.ajustes.find((x) => x.startsWith('preço frágil'));
  l.push(
    `- Teste de preço frágil: ${
      fragil ??
      (v4?.melhor?.stake && v4.melhor.nivel !== 'R3'
        ? 'passou'
        : 'não se aplica (a decisão não chegou à etapa de stake, ou é R3)')
    }`,
  );
  const alertas = d.problemasOdds.filter((p) => p.nivel === 'alerta').length;
  l.push(
    `- Odds excluídas por erro de leitura: ${d.errosOdds} · odds com alerta (ex.: sem horário): ${alertas}`,
  );

  // 5 · contexto
  l.push('', '5 · CONTEXTO (NÃO entra no cálculo; só para risco)');
  const ctx = CAMPOS_STATS.filter((c) => !CAMPOS_DO_MODELO.has(c.campo))
    .map((c) => linhaStat(c.campo, c.rotulo))
    .filter((x): x is string => !!x);
  l.push(...(ctx.length ? ctx : ['- Nenhuma outra estatística lida.']));
  if (d.desfalques.length)
    for (const t of ['casa', 'fora'] as const)
      l.push(
        `- Desfalques de ${nomes[t]}: ${
          d.desfalques
            .filter((x) => x.time === t)
            .map((x) => x.jogador)
            .join(', ') || 'nenhum informado'
        }`,
      );
  else if (r.semDesfalques) l.push('- Desfalques: nenhum (times completos)');
  for (const c of d.classificacao.filter((x) => x.doJogo)) {
    const partes = [`${c.pontos ?? '?'} pts`];
    if (c.jogos !== undefined)
      partes.push(
        `${c.jogos} jogos (${c.vitorias ?? '?'}V ${c.empates ?? '?'}E ${c.derrotas ?? '?'}D)`,
      );
    if (c.golsPro !== undefined) partes.push(`gols ${c.golsPro}:${c.golsContra ?? '?'}`);
    if (c.saldo !== undefined) partes.push(`saldo ${c.saldo > 0 ? '+' : ''}${c.saldo}`);
    if (c.forma)
      partes.push(`últimos ${c.forma.length} no print (esq. → dir.): ${c.forma.join(' ')}`);
    if (c.zona?.nome) partes.push(`zona ${c.zona.nome}`);
    l.push(`- Classificação: ${c.posicao}º ${c.time}: ${partes.join(', ')}`);
  }
  if (temTextoFlashscore(r)) l.push('- Texto de análise do Flashscore:', r.flashscore.trim());
  else if (r.flashscoreSemTexto) l.push('- Flashscore: o jogo não tem texto de análise');

  // 6 · lista informativa
  l.push(
    '',
    '6 · LISTA "MELHORES ENTRADAS" — EXCLUSIVAMENTE INFORMATIVA, SEM RECOMENDAÇÃO DE STAKE',
  );
  if (!d.entradas) l.push(`- ${INDISPONIVEL}`);
  else {
    if (!d.entradas.entradas.length) l.push('- Nenhuma entrada neste jogo.');
    for (const e of d.entradas.entradas) {
      const r2 = e.linha ? criarLiquidador(e.linha) : null;
      const liq = r2?.ok ? r2.liq : null;
      const nivel = r2?.ok ? r2.nivel : null;
      l.push(
        `- ${sem(e.descricao)} @ ${oddDecimal(e.odd)} (${e.casa}): chance ${pct(e.chance)} — origem: mistura w × P_modelo + (1−w) × P_mercado, com ${descricaoPeso(d, nivel)}; P_modelo ${pct(e.pModelo)} (${origemPModelo(d, liq)}); P_mercado ${pct(e.pMercado)} (${
          e.referenciaAfiada
            ? 'mediana das casas afiadas'
            : 'mediana de todas as casas, incluindo a da melhor odd'
        }) · acerto mínimo exigido pela odd: ${pct(e.minimo)} (= 1 ÷ odd efetiva ${oddDecimal(1 / e.minimo)})`,
      );
    }
    if (d.entradas.recusadas.length)
      l.push(`- Ficaram de fora pelos filtros: ${d.entradas.recusadas.length} mercado(s).`);
  }

  l.push('', ...PEDIDO);
  return l.join('\n');
}
