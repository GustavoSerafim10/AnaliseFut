import { describe, expect, it } from 'vitest';
import { avaliarDQ } from '../src/dataQuality';
import { analisarJogo } from '../src/decisao';
import { gerarRelatorio, relatorioEmTexto } from '../src/relatorio';
import { INICIO_VILLA, oddsVillaViking } from './helpers';

const base = {
  jogosMin: 31,
  temXg: true,
  temChutes: true,
  fontesStats: 3,
  desfalquesConhecidos: true,
  ligaTop: true,
  escalacaoProvavel: true,
};

describe('Data Quality automática', () => {
  it('tudo presente → A', () => expect(avaliarDQ(base).dq).toBe('A'));
  it('sem escalação conferida → B, com o motivo', () => {
    const r = avaliarDQ({ ...base, escalacaoProvavel: false });
    expect(r.dq).toBe('B');
    expect(r.motivos[0]).toContain('escalação');
  });
  it('sem desfalques → C', () =>
    expect(avaliarDQ({ ...base, desfalquesConhecidos: false }).dq).toBe('C'));
  it('≤ 3 jogos → D; sem base → E', () => {
    expect(avaliarDQ({ ...base, jogosMin: 3 }).dq).toBe('D');
    expect(avaliarDQ({ ...base, jogosMin: null }).dq).toBe('E');
  });
});

describe('análise escrita', () => {
  const resultado = analisarJogo({
    jogo: { casa: 'Aston Villa', fora: 'Viking', inicio: INICIO_VILLA },
    agora: '2026-10-21T10:00:00-03:00',
    dq: 'B',
    lambdaModelo: { casa: 2.5, fora: 1.15 },
    linhas: oddsVillaViking(),
    contexto: { favoritoLigaMaisForte: true },
  });
  const rel = gerarRelatorio({
    resultado,
    jogo: { casa: 'Aston Villa', fora: 'Viking' },
    destaquesStats: ['xG por jogo: Aston Villa 1,9 × 1,1 Viking.'],
    desfalques: [{ time: 'fora', jogador: 'Fulano' }],
  });

  it('veredito, resumo e seções', () => {
    expect(rel.veredito).toContain('NO BET');
    expect(rel.resumo).toContain('Aston Villa é favorito');
    expect(rel.secoes.map((s) => s.titulo)).toEqual([
      'Leitura do jogo',
      'O que as estatísticas mostram',
      'Contexto',
      'Onde está (ou não) o valor',
      'Riscos e contra-argumentos',
      'Decisão',
    ]);
  });
  it('explica o que precisaria mudar para virar aposta', () => {
    const valor = rel.secoes.find((s) => s.titulo.startsWith('Onde'))!;
    expect(valor.linhas.some((l) => l.includes('virar aposta seria preciso odd'))).toBe(true);
  });
  it('vira texto corrido para copiar', () => {
    expect(relatorioEmTexto(rel)).toContain('## Decisão');
  });
});
