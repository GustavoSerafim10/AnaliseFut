import { analisarJogo, type LinhaOdd } from '@pe/engine';
import { describe, expect, it } from 'vitest';
import { INICIO_VILLA, oddsVillaViking } from '../../engine/test/helpers';
import {
  checarSanidade,
  detectarFonte,
  detectarTituloMercado,
  juntarLinhas,
  lerPrint,
  parse1win,
  reconhecerTime,
} from '../src';
import { OCR_1WIN_TABELA, OCR_1WIN_VILLA, OCR_LIXO, OCR_SOFASCORE } from './fixtures';

const jogo = { casa: 'Aston Villa', fora: 'Viking' };
const ctx = { jogo, data: '2026-10-21' };

describe('detecção da fonte', () => {
  it('reconhece 1win, SofaScore e texto desconhecido', () => {
    expect(detectarFonte(OCR_1WIN_VILLA).fonte).toBe('1win');
    expect(detectarFonte(OCR_SOFASCORE).fonte).toBe('sofascore');
    expect(detectarFonte(OCR_LIXO).fonte).toBe('desconhecida');
  });
});

describe('reconhecimento de times', () => {
  it('tolera nomes longos e abreviações', () => {
    const j = { casa: 'Sporting', fora: 'LASK' };
    expect(reconhecerTime('Sporting Clube de Portugal CP', j)).toBe('casa');
    expect(reconhecerTime('LASK Linz', j)).toBe('fora');
    expect(reconhecerTime('Benfica', j)).toBeNull();
  });
});

describe('dicionário de sinônimos', () => {
  it.each([
    ['Total', 'total'],
    ['Gols mais/menos', 'total'],
    ['Over/Under', 'total'],
    ['Handicap asiático', 'AH'],
    ['Ambas marcam', 'ambas'],
    ['BTTS', 'ambas'],
    ['Dupla chance', 'DC'],
    ['Resultado do tempo regulamentar', '1X2'],
    ['Escanteios. Total', 'escanteios_total'],
  ])('"%s" → %s', (titulo, mercado) => {
    expect(detectarTituloMercado(titulo, jogo)?.mercado).toBe(mercado);
  });
  it('"Viking total" → gols só do Viking; "1º tempo" → período 1T', () => {
    expect(detectarTituloMercado('Viking total', jogo)).toEqual({
      mercado: 'total_time',
      periodo: 'FT',
      time: 'fora',
    });
    expect(detectarTituloMercado('Total 1º tempo', jogo)?.periodo).toBe('1T');
  });
});

describe('parser da 1win', () => {
  const r = parse1win(OCR_1WIN_VILLA, ctx);

  it('lê todas as 23 odds do print, com horário', () => {
    expect(r.linhas).toHaveLength(23);
    expect(r.horarioColeta).toBe('2026-10-21T09:30:00-03:00');
    expect(r.naoReconhecidas).toEqual([]);
  });

  it('lê o lado certo do handicap e do total por time', () => {
    expect(r.linhas).toContainEqual(
      expect.objectContaining({ mercado: 'AH', lado: 'casa', linha: -1.5, odd: 1.61 }),
    );
    expect(r.linhas).toContainEqual(
      expect.objectContaining({ mercado: 'AH', lado: 'fora', linha: 1.5, odd: 2.24 }),
    );
    expect(r.linhas).toContainEqual(
      expect.objectContaining({
        mercado: 'total_time',
        time: 'fora',
        lado: 'under',
        linha: 0.5,
        odd: 2.4,
      }),
    );
  });

  it('ponta a ponta: o motor dá o mesmo resultado que as odds digitadas', () => {
    const base = {
      jogo: { ...jogo, inicio: INICIO_VILLA },
      agora: '2026-10-21T10:00:00-03:00',
      dq: 'B' as const,
      lambdaModelo: { casa: 2.5, fora: 1.15 },
      contexto: { favoritoLigaMaisForte: true },
    };
    const lido = analisarJogo({ ...base, linhas: r.linhas as LinhaOdd[] });
    const digitado = analisarJogo({ ...base, linhas: oddsVillaViking() });
    expect(lido.decisao).toBe(digitado.decisao);
    expect(lido.lambdaMercado!.casa).toBeCloseTo(digitado.lambdaMercado!.casa, 6);
    expect(lido.lambdaMercado!.fora).toBeCloseTo(digitado.lambdaMercado!.fora, 6);
  });

  it('lê a forma de tabela', () => {
    const t = parse1win(OCR_1WIN_TABELA, ctx);
    expect(t.linhas).toHaveLength(4);
    expect(t.linhas[0]).toMatchObject({ mercado: 'total', lado: 'under', linha: 2.5, odd: 3.55 });
    expect(t.linhas[1]).toMatchObject({ lado: 'over', linha: 2.5, odd: 1.29 });
  });
});

describe('lerPrint', () => {
  it('layout desconhecido → aviso e nenhuma odd inventada', () => {
    const r = lerPrint(OCR_LIXO, ctx);
    expect(r.reconhecido).toBe(false);
    expect(r.linhas).toEqual([]);
    expect(r.avisos[0]).toContain('não reconheci');
  });
});

describe('juntar prints', () => {
  it('remove duplicadas e fica com a coleta mais recente', () => {
    const a = parse1win(OCR_1WIN_VILLA, ctx).linhas;
    const b = a
      .slice(0, 5)
      .map((l) => ({ ...l, odd: l.odd + 0.01, horarioColeta: '2026-10-21T10:30:00-03:00' }));
    const r = juntarLinhas(a, b);
    expect(r.linhas).toHaveLength(23);
    expect(r.duplicadas).toBe(5);
    expect(r.linhas.find((l) => l.mercado === '1X2' && l.lado === '1')?.odd).toBeCloseTo(1.25, 6);
  });
});

describe('sanidade', () => {
  const ok = parse1win(OCR_1WIN_VILLA, ctx).linhas as LinhaOdd[];
  it('print bom não tem erros', () => {
    expect(checarSanidade(ok).filter((p) => p.nivel === 'erro')).toEqual([]);
  });
  it('odd absurda e margem fora de 0–30% viram erro', () => {
    const ruim = ok.map((l) =>
      l.mercado === 'ambas' && l.lado === 'sim' ? { ...l, odd: 0.9 } : l,
    );
    const p = checarSanidade(ruim);
    expect(p.some((x) => x.mensagem.includes('fora da faixa'))).toBe(true);
    expect(p.some((x) => x.mensagem.includes('margem'))).toBe(true);
  });
  it('linhas fora de ordem viram alerta', () => {
    const trocado = ok.map((l) =>
      l.mercado === 'total' && l.lado === 'over' && l.linha === 3.5 ? { ...l, odd: 1.2 } : l,
    );
    expect(checarSanidade(trocado).some((x) => x.mensagem.includes('fora de ordem'))).toBe(true);
  });
  it('AH com o mesmo sinal nos dois lados → alerta de lado sem par', () => {
    const errado = ok.map((l) =>
      l.mercado === 'AH' && l.lado === 'fora' ? { ...l, linha: -1.5 } : l,
    );
    expect(checarSanidade(errado).some((x) => x.mensagem.includes('AH sem o outro lado'))).toBe(
      true,
    );
  });
});

describe('sanidade: primeiro gol contra o favorito do 1X2', () => {
  const l = (mercado: string, lado: string, odd: number): LinhaOdd =>
    ({
      casa: '1win',
      mercado,
      periodo: 'FT',
      lado,
      odd,
      horarioColeta: '2026-10-28T15:52:00-03:00',
    }) as LinhaOdd;
  const x12 = [l('1X2', '1', 1.4), l('1X2', 'X', 4.6), l('1X2', '2', 7.5)];
  it('Bragantino favorito "@ 2.88" para marcar primeiro: lados trocados → erro nas duas', () => {
    const p = checarSanidade([
      ...x12,
      l('primeiro_gol', 'casa', 2.88),
      l('primeiro_gol', 'fora', 1.36),
      l('primeiro_gol', 'nenhum', 13),
    ]);
    const erros = p.filter((x) => x.nivel === 'erro' && x.mensagem.includes('primeiro gol'));
    expect(erros.map((e) => e.indice).sort()).toEqual([3, 4]);
  });
  it('na ordem certa não acusa', () => {
    const p = checarSanidade([
      ...x12,
      l('primeiro_gol', 'casa', 1.36),
      l('primeiro_gol', 'fora', 2.88),
      l('primeiro_gol', 'nenhum', 13),
    ]);
    expect(p.some((x) => x.mensagem.includes('primeiro gol'))).toBe(false);
  });
});
