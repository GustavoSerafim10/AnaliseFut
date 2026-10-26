/**
 * Análise escrita: transforma o resultado do motor num texto de analista
 * (veredito, leitura do jogo, estatísticas, contexto, valor, riscos e decisão).
 * Só descreve o que o motor calculou: não cria probabilidade nem muda a decisão.
 */
import type { ResultadoAnalise } from './decisao';
import { NOMES_TESE } from './varredura';

export interface InsumosRelatorio {
  resultado: ResultadoAnalise;
  jogo: { casa: string; fora: string; competicao?: string };
  destaquesStats?: string[];
  contexto?: { categoria: string; time?: 'casa' | 'fora'; texto: string }[];
  desfalques?: { time: 'casa' | 'fora'; jogador: string }[];
  dqMotivos?: string[];
}

export interface SecaoRelatorio {
  titulo: string;
  linhas: string[];
}

export interface Relatorio {
  veredito: string;
  resumo: string;
  secoes: SecaoRelatorio[];
}

const p = (x: number) => `${(x * 100).toFixed(0)}%`;
const p1 = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
const n2 = (x: number) => x.toFixed(2).replace('.', ',');
const sem = (s: string) => s.replace(/^Ganha se: /, '').replace(/\.$/, '');

export function gerarRelatorio(i: InsumosRelatorio): Relatorio {
  const r = i.resultado;
  const { casa, fora } = i.jogo;
  const secoes: SecaoRelatorio[] = [];
  const m = r.melhor;
  const prev = r.previsao;

  // ----- resumo -----
  let resumo = '';
  if (prev) {
    const f = prev.p1x2.final;
    const fav = f.casa >= f.fora ? casa : fora;
    const pFav = Math.max(f.casa, f.fora);
    resumo = `${fav} é favorito (${p(pFav)} de vitória; empate ${p(f.empate)}). `;
    if (r.lambdaMercado) {
      resumo += `O mercado espera cerca de ${n2(r.lambdaMercado.total)} gols (${casa} ${n2(r.lambdaMercado.casa)} × ${n2(r.lambdaMercado.fora)} ${fora}). `;
    }
  }
  if (m) {
    resumo +=
      m.ev > 0
        ? `O melhor preço encontrado foi "${sem(m.descricao)}" a ${m.melhorOdd} (${m.casaMelhorOdd}), com EV de ${p1(m.ev)}.`
        : `Nenhum dos mercados enviados paga mais do que vale: o melhor ("${sem(m.descricao)}") tem EV de ${p1(m.ev)}.`;
  }

  // ----- leitura do jogo -----
  if (prev) {
    const l: string[] = [];
    const lm = r.lambdaModelo;
    l.push(
      `Modelo (estatísticas): ${casa} ${n2(lm.original.casa)} × ${n2(lm.original.fora)} ${fora} gols esperados` +
        (lm.ajustes.length
          ? `, ajustado para ${n2(lm.ajustado.casa)} × ${n2(lm.ajustado.fora)}.`
          : '.'),
    );
    if (r.lambdaMercado) {
      const dt = lm.ajustado.casa + lm.ajustado.fora - r.lambdaMercado.total;
      l.push(
        Math.abs(dt) < 0.2
          ? 'Modelo e mercado praticamente concordam no total de gols: quando os dois convergem, não costuma haver valor.'
          : `O modelo vê ${dt > 0 ? 'mais' : 'menos'} gols que o mercado (${dt > 0 ? '+' : ''}${n2(dt)}).`,
      );
    }
    l.push(...lm.ajustes.map((a) => `Ajuste: ${a}`));
    const f = prev.p1x2.final;
    l.push(
      `Probabilidades finais: ${casa} ${p(f.casa)} · empate ${p(f.empate)} · ${fora} ${p(f.fora)}; mais de 2,5 gols ${p(prev.over25.final)}.`,
    );
    l.push(
      `Placares mais prováveis: ${prev.placares.map((s) => `${s.casa}-${s.fora} (${p(s.p)})`).join(', ')}.`,
    );
    secoes.push({ titulo: 'Leitura do jogo', linhas: l });
  }

  if (i.destaquesStats?.length)
    secoes.push({ titulo: 'O que as estatísticas mostram', linhas: i.destaquesStats });

  const ctx: string[] = [];
  for (const t of ['casa', 'fora'] as const) {
    const ds = i.desfalques?.filter((d) => d.time === t).map((d) => d.jogador) ?? [];
    if (ds.length) ctx.push(`Desfalques ${t === 'casa' ? casa : fora}: ${ds.join(', ')}.`);
  }
  const relevantes = (i.contexto ?? []).filter((c) =>
    ['casa_fora', 'h2h', 'desfalques'].includes(c.categoria),
  );
  ctx.push(...relevantes.slice(0, 6).map((c) => c.texto));
  if (ctx.length) secoes.push({ titulo: 'Contexto', linhas: ctx });

  // ----- onde está (ou não) o valor -----
  if (r.varredura) {
    const v = r.varredura;
    const l = [
      `${v.avaliadas.length} mercados avaliados e ${v.descartados.length} descartados (margem > 10%, sem modelo ou incompletos).`,
    ];
    for (const a of v.top5) {
      l.push(
        `${sem(a.descricao)} @ ${a.melhorOdd}: modelo ${p1(a.pModelo)} × mercado ${p1(a.pMercado)} → EV ${p1(a.ev)} (${NOMES_TESE[a.tese]}).`,
      );
    }
    if (m && m.evMinimo !== null && m.ev < m.evMinimo) {
      const oddNecessaria = (1 + m.evMinimo / m.emRisco) / m.pFinal;
      l.push(
        `Para "${sem(m.descricao)}" virar aposta seria preciso odd ≥ ${n2(oddNecessaria)} (hoje ${m.melhorOdd}).`,
      );
    }
    secoes.push({ titulo: 'Onde está (ou não) o valor', linhas: l });
  }

  // ----- riscos -----
  const riscos: string[] = [];
  if (r.sensibilidade) {
    const pior = [...r.sensibilidade.cenarios].sort((a, b) => a.ev - b.ev)[0];
    riscos.push(
      `Sensibilidade ${r.sensibilidade.classe}: EV positivo em ${r.sensibilidade.positivos} de ${r.sensibilidade.cenarios.length} cenários` +
        (pior ? `; pior cenário "${pior.nome}" com EV ${p1(pior.ev)}.` : '.'),
    );
  }
  if (m) {
    const div = Math.abs(m.pModelo - m.pMercado);
    if (div > 0.08)
      riscos.push(
        `Modelo e mercado divergem ${p1(div)} nesse mercado: o que o mercado sabe que o modelo não captou?`,
      );
  }
  riscos.push(
    `Data Quality ${r.dq.efetiva}: ${[...(i.dqMotivos ?? []), ...r.dq.motivos].join('; ') || 'ok'}.`,
  );
  riscos.push(...r.avisos);
  secoes.push({ titulo: 'Riscos e contra-argumentos', linhas: riscos });

  // ----- decisão -----
  const dec: string[] = [...r.motivos];
  if (r.decisao === 'BET' && m?.stake) {
    dec.push(
      `Entrada: ${sem(m.descricao)} na ${m.casaMelhorOdd} a ${m.melhorOdd} (aceitar só odd ≥ ${n2(m.priceGate?.oddMinima ?? m.melhorOdd)}), stake ${p1(m.stake.fracaoBanca)} da banca${m.stake.valor !== undefined ? ` (R$ ${m.stake.valor.toFixed(2)})` : ''}.`,
    );
  }
  if (r.gatilho) dec.push(`Gatilho: ${r.gatilho}.`);
  if (r.decisao === 'NO_BET')
    dec.push('Sem vantagem real, o certo é não entrar. NO BET também é resultado.');
  secoes.push({ titulo: 'Decisão', linhas: dec });

  return { veredito: `${r.rotulo}${r.motivos[0] ? ` — ${r.motivos[0]}` : ''}`, resumo, secoes };
}

export function relatorioEmTexto(rel: Relatorio): string {
  return [
    rel.veredito,
    '',
    rel.resumo,
    '',
    ...rel.secoes.flatMap((s) => [`## ${s.titulo}`, ...s.linhas.map((l) => `- ${l}`), '']),
  ].join('\n');
}
