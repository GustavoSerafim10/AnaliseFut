/**
 * Monta um prompt com TODOS os dados + o resultado do motor para colar no chat do Claude.
 * Não chama API nenhuma: só gera texto para a área de transferência.
 */
import { descreverAposta, relatorioEmTexto, type LinhaOdd } from '@pe/engine';
import { CAMPOS_STATS } from '@pe/parsers';
import type { Derivado } from './dados';
import type { Rascunho } from './estado';

export function montarPromptClaude(r: Rascunho, d: Derivado): string {
  const nomes = { casa: r.jogo.casa, fora: r.jogo.fora };
  const l: string[] = [];
  l.push(
    'Você é um analista de apostas esportivas pré-live, rigoroso e construtivo.',
    'Abaixo estão os dados de um jogo e o resultado de um motor de precificação determinístico (protocolo V3.3: Poisson + Dixon-Coles, λ do mercado por mínimos quadrados, de-vig, blend modelo × mercado, gates de EV, sensibilidade e Kelly fracionado).',
    'Regras:',
    '- Não invente dados, odds, lesões nem probabilidades. Se faltar algo, diga que falta.',
    '- A decisão (BET / WATCHLIST / INVESTIGAR / NO BET) é do motor. Você pode criticá-la e apontar riscos, mas não a substitua.',
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
  if (r.flashscore.trim()) l.push('', '# Texto de análise do Flashscore', r.flashscore.trim());
  l.push('', '# Odds coletadas');
  for (const o of r.odds)
    l.push(
      `- ${o.casa}: ${descreverAposta(o as LinhaOdd, nomes).replace('Ganha se: ', '')} @ ${o.odd}`,
    );
  if (d.relatorio) l.push('', '# Resultado do motor', relatorioEmTexto(d.relatorio));
  return l.join('\n');
}
