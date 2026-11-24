/**
 * Competição e temporada da amostra (Parte A): resumo, item 3d do checklist, prompt, aviso de liga
 * (P2) e isolamento — a leitura é só exibição: DQ, λ, decisão V4 e conteúdo da evidência não mudam.
 */
import { readFileSync } from 'node:fs';
import { lerContextoAmostra, type LeituraContexto } from '@pe/parsers';
import { describe, expect, it, vi } from 'vitest';
import { montarPromptClaude } from '../src/claude';
import { resumirContextoAmostra, temporadaRelativa } from '../src/contextoDaAmostra';
import { derivar } from '../src/dados';
import type { Rascunho } from '../src/estado';
import { canonico, montarConteudo } from '../src/evidencias';
import { rascunhoExemplo } from '../src/exemplo';
import { avisoLigaDoJogo } from '../src/leituraDecisao';

const fx = (n: string) =>
  readFileSync(
    new URL(`../../../packages/parsers/test/fixtures-reais/${n}`, import.meta.url),
    'utf8',
  );
const ler = (sofa: string[], sup: string[]): LeituraContexto[] => [
  ...sofa.flatMap((t) => lerContextoAmostra(t, 'sofascore')),
  ...sup.flatMap((t) => lerContextoAmostra(t, 'superscore')),
];
const sofaSint = (linha: string) =>
  `Comparação de equipes\nAdicionar outra equipe\nA B\nBrasil Brasil\n${linha}\nGeral\nPartidas 10 10`;

describe('temporada atual/anterior (P3: só quando inequívoco)', () => {
  it.each([
    ['2026', '2026-11-24', 'atual'],
    ['2025', '2026-11-24', 'anterior'],
    ['2027', '2026-11-24', 'indeterminada'],
    ['2026/27', '2026-09-10', 'atual'],
    ['2026/27', '2027-03-10', 'atual'],
    ['2026/27', '2026-07-10', 'indeterminada'],
    ['2026/27', '2027-06-10', 'indeterminada'],
    ['2026/27', '2027-08-20', 'anterior'],
    ['2026/27', '2026-03-10', 'indeterminada'],
  ])('%s em %s → %s', (t, data, esperado) => expect(temporadaRelativa(t, data)).toBe(esperado));
});

describe('resumo e item 3d', () => {
  const jogo = { competicao: 'Brasileirão', data: '2026-11-24' };
  it('prints reais do Remo (SofaScore + SuperScore): mesma competição, 2026 atual → NÃO', () => {
    const c = resumirContextoAmostra(
      ler([fx('sofascore-remo-1.txt')], [fx('superscore-remo-1.txt')]),
      jogo,
    );
    expect(c).toMatchObject({
      legivel: true,
      temporadas: ['2026'],
      temporadaRelativa: 'atual',
      coincideComJogo: true,
      mista: false,
      fontesDivergem: false,
      item3d: 'NÃO',
      competicaoPrincipal: 'Campeonato Brasileiro Série A',
    });
  });

  it('Frosinone: 26/27 reconstruída no SofaScore e lida no SuperScore → NÃO, atual em novembro', () => {
    const c = resumirContextoAmostra(
      ler([fx('sofascore-frosinone-1.txt')], [fx('superscore-frosinone-1.txt')]),
      {
        competicao: 'Serie A',
        data: '2026-11-08',
      },
    );
    expect(c).toMatchObject({ temporadas: ['2026/27'], temporadaRelativa: 'atual', item3d: 'NÃO' });
  });

  it('"Todas as competições" → mista, SIM, e nunca competição única (P2 não usa)', () => {
    const c = resumirContextoAmostra(
      ler([sofaSint('Todas as competições v 2026 v Todas as competições v 2026')], []),
      jogo,
    );
    expect(c).toMatchObject({ todas: true, mista: true, item3d: 'SIM', competicaoPrincipal: null });
    expect(c.motivos.join(' ')).toContain('Todas as competições');
  });

  it('SIM: lados diferentes, temporada anterior, fontes divergentes, competição ≠ cadastrada', () => {
    const lados = resumirContextoAmostra(
      ler([sofaSint('Copa do Brasil v 2026 v Campeonato Brasileiro Série A v 2026')], []),
      jogo,
    );
    expect(lados).toMatchObject({ mista: true, item3d: 'SIM' });
    const anterior = resumirContextoAmostra(
      ler([], ['ESTATÍSTICAS PRINCIPAIS\nBrasileiro Série A 2025']),
      jogo,
    );
    expect(anterior).toMatchObject({ temporadaRelativa: 'anterior', item3d: 'SIM' });
    const divergem = resumirContextoAmostra(
      ler([fx('sofascore-remo-1.txt')], [fx('superscore-frosinone-1.txt')]),
      jogo,
    );
    expect(divergem).toMatchObject({ fontesDivergem: true, item3d: 'SIM' });
    const outra = resumirContextoAmostra(ler([], [fx('superscore-remo-1.txt')]), {
      competicao: 'Copa do Brasil',
      data: '2026-11-24',
    });
    expect(outra).toMatchObject({ coincideComJogo: false, item3d: 'SIM' });
  });

  it('DADO INDISPONÍVEL: ilegível, ou só parte lida (nada presumido)', () => {
    expect(
      resumirContextoAmostra(ler([fx('sofascore-londrina-zoom-60.txt')], []), jogo),
    ).toMatchObject({ legivel: false, item3d: 'DADO INDISPONÍVEL' });
    // Remo só pelo SofaScore: temporada ilegível nos dois lados
    expect(resumirContextoAmostra(ler([fx('sofascore-remo-1.txt')], []), jogo).item3d).toBe(
      'DADO INDISPONÍVEL',
    );
    // só o lado do mandante
    expect(
      resumirContextoAmostra(ler([sofaSint('Campeonato Brasileiro Série A v 2026 v')], []), jogo)
        .item3d,
    ).toBe('DADO INDISPONÍVEL');
  });
});

describe('site: prompt, aviso de liga e isolamento', () => {
  function comPrints(cabecalhoSofa?: string): Rascunho {
    vi.useFakeTimers({ now: new Date('2026-11-24T15:00:00Z'), toFake: ['Date'] });
    const r0 = rascunhoExemplo();
    vi.useRealTimers();
    let sofa1 = fx('sofascore-remo-1.txt');
    if (cabecalhoSofa)
      sofa1 = sofa1.replace(/^.*Campeonato Brasileiro Série A v 20%.*$/m, cabecalhoSofa);
    const p = (arquivo: string, texto: string) => ({ arquivo, texto });
    return {
      ...r0,
      jogo: { ...r0.jogo, casa: 'Remo', fora: 'Botafogo', competicao: '' },
      correcoes: {},
      prints: {
        ...r0.prints,
        sofascore: [p('s1', sofa1), p('s2', fx('sofascore-remo-2.txt'))],
        superscore: [
          p('u1', fx('superscore-remo-1.txt')),
          p('u2', fx('superscore-remo-2.txt')),
          p('u3', fx('superscore-remo-3.txt')),
        ],
      },
    };
  }
  const derivarEm = (r: Rascunho) => {
    vi.useFakeTimers({ now: new Date('2026-11-24T15:00:00Z'), toFake: ['Date'] });
    try {
      return derivar(r);
    } finally {
      vi.useRealTimers();
    }
  };

  it('o prompt mostra competição, temporada e o item 3d lidos', () => {
    const r = comPrints();
    const t = montarPromptClaude(r, derivarEm(r));
    expect(t).toContain(
      '- Período e competição: Campeonato Brasileiro Série A · 2026 · temporada atual',
    );
    expect(t).toContain(
      'lido no cabeçalho dos prints: SofaScore (mandante e visitante); SuperScore (os dois times)',
    );
    expect(t).toContain('(checklist 3d): NÃO');
    expect(t).toContain('não a contradiga');
  });

  it('sem prints de estatística: continua NÃO INFORMADO e DADO INDISPONÍVEL', () => {
    const r = rascunhoExemplo();
    const t = montarPromptClaude(r, derivarEm(r));
    expect(t).toContain('Período e competição: NÃO INFORMADO');
    expect(t).toContain('(checklist 3d): DADO INDISPONÍVEL');
  });

  it('P2: jogo sem competição cadastrada → o aviso usa a da amostra, dizendo de onde veio', () => {
    const r = comPrints();
    const d = derivarEm(r);
    const a = avisoLigaDoJogo(r.jogo.competicao, d.contextoAmostra.competicaoPrincipal, false);
    expect(a).toContain('parece liga principal');
    expect(a).toContain('lida nos prints de estatística');
    expect(avisoLigaDoJogo('Série C', 'Campeonato Brasileiro Série A', false)).toBeNull();
    expect(avisoLigaDoJogo('', null, false)).toBeNull();
  });

  it('isolamento: trocar só o cabeçalho para "Todas as competições" muda a leitura, não DQ, λ, V4 nem a evidência', () => {
    const a = derivarEm(comPrints());
    const b = derivarEm(
      comPrints('3} Todas as competições v 2026 v 3} Todas as competições v 2026'),
    );
    expect(a.contextoAmostra.item3d).toBe('NÃO');
    expect(b.contextoAmostra.item3d).toBe('SIM');
    // o prompt diz SIM quando a leitura diz SIM (nunca afirma NÃO sem base)
    const rb = comPrints('3} Todas as competições v 2026 v 3} Todas as competições v 2026');
    const tb = montarPromptClaude(rb, b);
    expect(tb).toContain('(checklist 3d): SIM — filtro "Todas as competições" no print');
    expect(tb).toContain('Período e competição: Todas as competições');
    expect(b.dq).toEqual(a.dq);
    expect(b.lambda).toEqual(a.lambda);
    expect(JSON.stringify(b.v4)).toBe(JSON.stringify(a.v4));
    const conteudo = canonico(montarConteudo(comPrints(), a, {}));
    expect(conteudo).not.toContain('item3d');
    expect(conteudo).not.toContain('todasCompeticoes');
  });
});
