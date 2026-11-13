import { describe, expect, it } from 'vitest';
import { precificar } from '../src/precificacao';
import type { LinhaOdd, TipoMercado } from '../src/tipos';
import { analisarV4, type EntradaV4 } from '../src/v4';

const JOGO = { casa: 'Flamengo', fora: 'Atlético-MG', inicio: '2026-10-26T20:00:00-03:00' };
const AGORA = '2026-10-26T16:00:00-03:00';
const H = (hhmm: string) => `2026-10-26T${hhmm}:00-03:00`;

const linha = (
  casa: string,
  mercado: TipoMercado,
  lado: string,
  odd: number,
  hora: string | undefined,
  extra: Partial<LinhaOdd> = {},
): LinhaOdd => ({
  casa,
  mercado,
  lado,
  odd,
  periodo: 'FT',
  horarioColeta: hora ? H(hora) : undefined,
  ...extra,
});
const ou = (casa: string, over: number, under: number, hora: string | undefined = '16:00') => [
  linha(casa, 'total', 'over', over, hora, { linha: 2.5 }),
  linha(casa, 'total', 'under', under, hora, { linha: 2.5 }),
];
const entrada = (linhas: LinhaOdd[], extra: Partial<EntradaV4> = {}): EntradaV4 => ({
  jogo: JOGO,
  agora: AGORA,
  linhas,
  ligaPrincipal: true,
  banca: 1000,
  ...extra,
});

/** entrada com todo tipo de destino: avaliada, substituída, inválida, incompleta e DC sem 1X2 */
function misturada(): LinhaOdd[] {
  return [
    ...ou('Pinnacle', 1.95, 1.95),
    ...ou('1win', 2.1, 1.72, '15:00'), // substituída pela coleta de 16:00
    ...ou('1win', 2.0, 1.8, '16:00'),
    linha('1win', 'total', 'over', 1.0, '16:00', { linha: 3.5 }), // odd inválida
    linha('1win', 'ambas', 'sim', 1.9, '16:00'), // mercado incompleto (falta o "não")
    linha('1win', 'DC', '1X', 1.3, '16:00'), // DC sem o 1X2 da mesma casa
    linha('1win', 'DC', '12', 1.3, '16:00'),
    linha('1win', 'DC', 'X2', 1.9, '16:00'),
  ];
}

describe('rastro por linha', () => {
  it('toda linha recebida tem exatamente um destino, na mesma ordem, sem lacuna', () => {
    const linhas = misturada();
    const r = analisarV4(entrada(linhas));
    expect(r.rastro).toHaveLength(linhas.length);
    r.rastro.forEach((t, i) => {
      expect(t.indice).toBe(i);
      expect(t.linha).toBe(linhas[i]); // a linha original, intacta
      expect(['avaliada', 'descartada', 'invalida', 'substituida']).toContain(t.destino);
      expect(t.motivo ?? '').not.toContain('sem destino registrado');
      expect(t.motivo ?? '').not.toContain('sem avaliação registrada');
    });
    // nenhuma linha fica em estado intermediário
    expect(r.rastro.some((t) => t.destino === ('precificada' as string))).toBe(false);
  });

  it('cada tipo de destino aparece onde deve', () => {
    const r = analisarV4(entrada(misturada()));
    const d = (i: number) => r.rastro[i].destino;
    expect(d(0)).toBe('avaliada'); // Pinnacle over
    expect(d(2)).toBe('substituida'); // 1win 15:00
    expect(d(4)).toBe('avaliada'); // 1win 16:00
    expect(d(6)).toBe('invalida'); // odd 1.0
    expect(d(7)).toBe('descartada'); // ambas incompleto
    expect(r.rastro[7].motivo).toContain('mercado incompleto');
    expect(d(8)).toBe('descartada'); // DC sem 1X2
    expect(r.rastro[8].motivo).toContain('DC sem 1X2');
  });

  it('linha avaliada diz se foi a melhor odd ou preço de apoio', () => {
    const r = analisarV4(entrada(misturada()));
    expect(r.rastro[4].papel).toBe('melhor odd'); // 1win over 2.0 é a melhor odd (casa mole)
    expect(r.rastro[0].papel).toBe('preço de apoio'); // Pinnacle é a referência
  });

  it('seleção descartada pela V4 leva o motivo dela nas linhas precificadas', () => {
    // uma casa só e sem modelo: R4, tudo descartado por falta de referência
    const r = analisarV4(entrada(ou('1win', 2.1, 1.72)));
    expect(r.rastro.every((t) => t.destino === 'descartada')).toBe(true);
    expect(r.rastro[0].motivo).toContain('sem referência');
  });

  it('jogo iniciado: todas as linhas ainda têm destino e motivo', () => {
    const r = analisarV4(entrada(misturada(), { agora: '2026-10-26T21:00:00-03:00' }));
    expect(r.decisao).toBe('EXCLUIDO');
    expect(r.rastro).toHaveLength(misturada().length);
    expect(r.rastro.every((t) => t.destino === 'descartada' && !!t.motivo)).toBe(true);
  });
});

describe('substituição de snapshots', () => {
  it('registra casa, operador, mercado, seleção, odd e horário anteriores, a nova e o motivo', () => {
    const r = analisarV4(entrada(misturada()));
    const t = r.rastro[2]; // 1win over @2.1, 15:00
    expect(t.destino).toBe('substituida');
    expect(t.casa).toBe('1win');
    expect(t.operatorId).toBe('1win');
    expect(t.linha.mercado).toBe('total');
    expect(t.chave).toBe('total|FT|-|2.5|over');
    expect(t.linha.odd).toBe(2.1);
    expect(t.linha.horarioColeta).toBe(H('15:00'));
    expect(t.substituidaPor).toEqual({ indice: 4, odd: 2.0, horarioColeta: H('16:00') });
    expect(t.motivo).toContain('coleta mais recente');
  });

  it('coleta mais antiga lida depois também é registrada, e a mais nova fica', () => {
    const linhas = [...ou('1win', 2.0, 1.8, '16:00'), ...ou('1win', 2.3, 1.6, '14:00')];
    const p = precificar(linhas);
    expect(p.rastro[2].destino).toBe('substituida');
    expect(p.rastro[2].motivo).toContain('mais antiga');
    expect(p.rastro[2].substituidaPor?.indice).toBe(0);
    expect(p.selecoes.find((s) => s.chave.endsWith('over'))!.melhor.odd).toBe(2.0);
  });

  it('mesmo horário ou sem horário: fica a primeira lida (como sempre foi)', () => {
    const linhas = [...ou('1win', 2.0, 1.8, undefined), ...ou('1win', 2.3, 1.6, undefined)];
    const p = precificar(linhas);
    expect(p.rastro[2].destino).toBe('substituida');
    expect(p.rastro[2].motivo).toContain('primeira lida');
    expect(p.selecoes.find((s) => s.chave.endsWith('over'))!.melhor.odd).toBe(2.0);
  });

  it('três coletas: as duas mais velhas ficam registradas', () => {
    const linhas = [
      ...ou('1win', 2.0, 1.8, '14:00'),
      ...ou('1win', 2.1, 1.75, '15:00'),
      ...ou('1win', 2.2, 1.7, '16:00'),
    ];
    const p = precificar(linhas);
    expect(p.rastro.filter((t) => t.destino === 'substituida')).toHaveLength(4);
    expect(p.rastro[4].destino).toBe('precificada');
  });

  it('o cálculo não muda: com ou sem as coletas antigas, mesmas seleções e mesmas probabilidades', () => {
    const base = [...ou('Pinnacle', 1.95, 1.95), ...ou('1win', 2.0, 1.8, '16:00')];
    // coletas antigas DEPOIS das atuais: a ordem dos grupos fica a mesma
    const comAntigas = [
      ...base,
      ...ou('1win', 2.1, 1.72, '15:00'),
      ...ou('1win', 2.4, 1.6, '14:00'),
      ...ou('Pinnacle', 1.8, 2.1, '12:00'),
    ];
    // coletas antigas ANTES (substituídas por uma mais nova): só a ordem das listas muda
    const antigasAntes = [
      ...ou('1win', 2.1, 1.72, '15:00'),
      ...ou('Pinnacle', 1.8, 2.1, '12:00'),
      ...base,
    ];
    const normaliza = (p: ReturnType<typeof precificar>) =>
      p.selecoes
        .map((s) => ({
          chave: s.chave,
          pMercado: s.pMercado,
          margem: s.margem,
          melhor: s.melhor.odd,
          precos: s.precos.map((x) => [x.casa, x.odd, x.pJusta]).sort(),
        }))
        .sort((x, y) => x.chave.localeCompare(y.chave));
    expect(normaliza(precificar(antigasAntes))).toEqual(normaliza(precificar(base)));
    const a = precificar(base);
    const b = precificar(comAntigas);
    expect(b.selecoes).toEqual(a.selecoes);
    expect(b.descartes).toEqual(a.descartes);
    expect(b.casas).toEqual(a.casas);
    const va = analisarV4(entrada(base));
    const vb = analisarV4(entrada(comAntigas));
    expect(vb.decisao).toBe(va.decisao);
    expect(vb.melhor?.ev).toBe(va.melhor?.ev);
    expect(vb.melhor?.pTrue).toBe(va.melhor?.pTrue);
    expect(vb.avaliadas.map((x) => [x.chave, x.ev, x.pTrue])).toEqual(
      va.avaliadas.map((x) => [x.chave, x.ev, x.pTrue]),
    );
    expect(vb.descartados).toEqual(va.descartados);
  });
});

describe('duas coletas da mesma casa não são dois operadores', () => {
  it('"Bet365" e "bet365.com" em horários diferentes: uma casa, uma substituída', () => {
    const linhas = [
      ...ou('Bet365', 1.9, 1.9, '15:00'),
      ...ou('bet365.com', 1.95, 1.85, '16:00'),
      ...ou('Betano', 1.9, 1.9),
      ...ou('Superbet', 1.9, 1.9),
    ];
    const r = analisarV4(entrada(linhas));
    // 3 operadores (Bet365, Betano, Superbet): não chega a R2, que exige 4
    expect(r.referencia.nivel).not.toBe('R2');
    expect(r.referencia.moles).toHaveLength(3);
    expect(r.rastro[0].destino).toBe('substituida');
    expect(r.rastro[0].operatorId).toBe(r.rastro[2].operatorId);
    expect(r.rastro[0].casa).toBe('Bet365'); // o nome do print é preservado
    expect(r.rastro[2].casa).toBe('bet365.com');
  });

  it('com um quarto operador forma R2 e a coleta antiga da mesma casa não vota de novo', () => {
    const linhas = [
      ...ou('Bet365', 1.5, 2.6, '15:00'), // coleta velha, preço torto: não pode entrar no consenso
      ...ou('Bet365', 1.9, 1.9, '16:00'),
      ...ou('Betano', 1.9, 1.9),
      ...ou('Superbet', 1.9, 1.9),
      ...ou('1win', 2.12, 1.8),
    ];
    const r = analisarV4(entrada(linhas));
    expect(r.referencia.nivel).toBe('R2');
    expect(r.melhor?.casaMelhorOdd).toBe('1win');
    expect(r.melhor?.pTrue).toBeCloseTo(0.5, 10);
  });
});
