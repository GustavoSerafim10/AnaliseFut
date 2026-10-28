/**
 * Monta um prompt com TODOS os dados + o resultado do motor para colar no chat do Claude.
 * Não chama API nenhuma: só gera texto para a área de transferência.
 */
import { descreverAposta, relatorioEmTexto, type LinhaOdd } from '@pe/engine';
import { CAMPOS_STATS } from '@pe/parsers';
import { temTextoFlashscore, type Derivado } from './dados';
import type { Rascunho } from './estado';

export function montarPromptClaude(r: Rascunho, d: Derivado): string {
  const nomes = { casa: r.jogo.casa, fora: r.jogo.fora };
  const l: string[] = [];
  l.push(
    'Você é um analista de apostas esportivas pré-live, rigoroso e construtivo.',
    'Abaixo estão os dados de um jogo e o resultado de um motor determinístico. A decisão segue o protocolo V4.0: P_true da Pinnacle/Betfair sem margem (ou do consenso de 4+ casas), entrada só quando uma casa de varejo paga acima desse preço, CLV como métrica principal. O motor V3.3 é o apoio (Poisson + Dixon-Coles, λ do mercado por mínimos quadrados, de-vig, blend modelo × mercado, gates de EV, sensibilidade e Kelly fracionado; escanteios e cartões amarelos com binomial negativa por time, nível 3, modelo pesando no máximo 30%).',
    'Regras:',
    '- Não invente dados, odds, lesões nem probabilidades. Se faltar algo, diga que falta.',
    '- A decisão (BET / WATCHLIST / INVESTIGAR / NO BET) é do motor V4.0. Você pode criticá-la e apontar riscos, mas não a substitua.',
    '- NO BET é um resultado legítimo; não force uma aposta.',
    'Escreva em português: (1) leitura do jogo; (2) o que os números dizem; (3) contexto (desfalques, casa/fora, confronto direto); (4) por que a melhor entrada é ou não é essa; (5) red team com 3 argumentos contra, um deles atacando a premissa do modelo; (6) conclusão em 3 linhas.',
    '',
    `# Jogo: ${r.jogo.casa} × ${r.jogo.fora}`,
    `${r.jogo.competicao} · ${r.jogo.data} ${r.jogo.hora}`,
    '',
    '# Estatísticas consolidadas (SofaScore + SuperScore, médias por jogo salvo indicação)',
  );
  for (const c of CAMPOS_STATS) {
    const v = d.tabela[c.campo];
    if (!v) continue;
    const f = (x?: number) => (x === undefined ? '?' : String(Number(x.toFixed(2))));
    l.push(
      `- ${c.rotulo}: ${nomes.casa} ${f(v.casa.valor)} × ${f(v.fora.valor)} ${nomes.fora}${v.casa.divergente || v.fora.divergente ? ' (fontes divergem)' : ''}`,
    );
  }
  if (d.desfalques.length) {
    l.push('', '# Desfalques');
    for (const t of ['casa', 'fora'] as const)
      l.push(
        `- ${nomes[t]}: ${
          d.desfalques
            .filter((x) => x.time === t)
            .map((x) => x.jogador)
            .join(', ') || 'nenhum informado'
        }`,
      );
  }
  if (d.classificacao.some((c) => c.doJogo)) {
    l.push('', '# Classificação');
    for (const c of d.classificacao.filter((x) => x.doJogo))
      l.push(`- ${c.posicao}º ${c.time} (${c.pontos ?? '?'} pts)`);
  }
  if (temTextoFlashscore(r)) l.push('', '# Texto de análise do Flashscore', r.flashscore.trim());
  else if (r.flashscoreSemTexto) l.push('', '# Flashscore: o jogo não tem texto de análise');
  l.push('', '# Odds coletadas');
  for (const o of r.odds)
    l.push(
      `- ${o.casa}: ${descreverAposta(o as LinhaOdd, nomes).replace('Ganha se: ', '')} @ ${o.odd}`,
    );
  if (d.v4) {
    l.push(
      '',
      '# Decisão V4.0 (referência × casa mole)',
      `${d.v4.rotulo} · referência ${d.v4.referencia.nivel}`,
    );
    l.push(...d.v4.motivos.map((m) => `- ${m}`), ...d.v4.avisos.map((m) => `- aviso: ${m}`));
    for (const a of d.v4.top5)
      l.push(
        `- ${a.descricao.replace('Ganha se: ', '')} @ ${a.melhorOdd} (${a.casaMelhorOdd}): P_true ${(a.pTrue * 100).toFixed(1)}% (${a.fonteP}), EV ${(a.ev * 100).toFixed(1)}%, ${a.nivel}/${a.estrategia}`,
      );
  }
  if (d.relatorio) l.push('', '# Motor de apoio V3.3', relatorioEmTexto(d.relatorio));
  return l.join('\n');
}
