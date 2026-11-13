/** Etapa 3B: blindagem de entradas, tolerância numérica documentada e arredondamento monetário. */
import { describe, expect, it } from 'vitest';
import {
  autorizarStake,
  EV_TOLERANCIA,
  kellyCheio,
  motivoEntradaInvalida,
  valorEmReais,
} from '../src/kelly';

const ok = { fracaoKelly: 0.25, banca: 1000 };

describe('validação de odd e probabilidade', () => {
  it('odd finita e estritamente maior que 1', () => {
    expect(motivoEntradaInvalida(0.5, 1.0001)).toBeNull();
    for (const odd of [1, 0.99, 0, -1, NaN, Infinity, -Infinity])
      expect(motivoEntradaInvalida(0.5, odd)).toContain('odd inválida');
  });

  it('probabilidade finita e dentro de (0, 1)', () => {
    expect(motivoEntradaInvalida(0.0001, 2)).toBeNull();
    expect(motivoEntradaInvalida(0.9999, 2)).toBeNull();
    for (const p of [0, 1, -0.1, 1.5, NaN, Infinity])
      expect(motivoEntradaInvalida(p, 2)).toContain('probabilidade');
  });

  it('tipos errados (null, undefined, texto) também são recusados, sem exceção', () => {
    expect(motivoEntradaInvalida(0.5, null as unknown as number)).toContain('odd inválida');
    expect(motivoEntradaInvalida(undefined as unknown as number, 2)).toContain('probabilidade');
    expect(motivoEntradaInvalida(0.5, '2' as unknown as number)).toContain('odd inválida');
  });

  it('autorizarStake devolve stake zero e o MOTIVO para auditoria', () => {
    const casos: [number, number, string][] = [
      [0.5, 1, 'precisa ser maior que 1'],
      [0.5, NaN, 'não é um número finito'],
      [NaN, 2, 'probabilidade inválida'],
      [1.2, 2, 'fora do intervalo'],
      [0.5, Infinity, 'não é um número finito'],
    ];
    for (const [p, odd, trecho] of casos) {
      const s = autorizarStake({ p, odd, ...ok });
      expect(s.autorizada).toBe(false);
      expect(s.fracaoBanca).toBe(0);
      expect(s.valor).toBe(0);
      expect(s.motivo).toContain(trecho);
      expect(Number.isNaN(s.kellyCheio)).toBe(false);
      expect(Number.isNaN(s.fracaoKelly)).toBe(false);
    }
  });

  it('parâmetros inválidos do pedido também zeram, com motivo', () => {
    const base = { p: 0.6, odd: 2 };
    expect(autorizarStake({ ...base, fracaoKelly: NaN }).motivo).toContain('fração de Kelly');
    expect(autorizarStake({ ...base, fracaoKelly: -0.1 }).motivo).toContain('fração de Kelly');
    expect(autorizarStake({ ...base, fracaoKelly: 0.25, teto: NaN }).motivo).toContain('teto');
    expect(autorizarStake({ ...base, fracaoKelly: 0.25, folgaDia: NaN }).motivo).toContain('folga');
    expect(autorizarStake({ ...base, fracaoKelly: 0.25, banca: NaN }).motivo).toContain('banca');
    expect(autorizarStake({ ...base, fracaoKelly: 0.25, banca: 0 }).motivo).toContain('banca');
    expect(autorizarStake({ ...base, fracaoKelly: 0.25, banca: -5 }).fracaoBanca).toBe(0);
    // redução inválida só pode diminuir: NaN conta como zero
    expect(autorizarStake({ ...base, fracaoKelly: 0.25, reducoes: [NaN] }).fracaoBanca).toBe(0);
  });

  it('um pedido válido fica autorizado e sem motivo', () => {
    const s = autorizarStake({ p: 0.6, odd: 2, ...ok });
    expect(s.autorizada).toBe(true);
    expect(s.motivo).toBeUndefined();
  });
});

describe('EV nulo ou negativo: stake zero, com tolerância documentada', () => {
  it('a tolerância é 1e-12 e está acima do ruído do ponto flutuante (~1e-16)', () => {
    expect(EV_TOLERANCIA).toBe(1e-12);
    expect(EV_TOLERANCIA).toBeGreaterThan(1e-14);
  });

  it('EV exatamente zero, em muitos pares (p, odd = 1/p): stake exatamente zero', () => {
    let n = 0;
    for (let p = 0.05; p < 0.96; p += 0.0137) {
      const s = autorizarStake({ p, odd: 1 / p, ...ok });
      expect(s.fracaoBanca).toBe(0);
      expect(s.valor).toBe(0);
      n++;
    }
    expect(n).toBeGreaterThan(50);
  });

  it('EV negativo: stake zero e motivo', () => {
    const s = autorizarStake({ p: 0.4, odd: 2, ...ok });
    expect(s.autorizada).toBe(false);
    expect(s.fracaoBanca).toBe(0);
    expect(s.motivo).toContain('sem vantagem');
    expect(kellyCheio(0.4, 2)).toBeCloseTo(-0.2, 12); // o Kelly negativo continua visível
  });

  it('edges positivos MUITO pequenos sobrevivem: a tolerância não elimina valor real', () => {
    // de 1e-6 (0,0001%) até 1e-10: todos acima da tolerância, todos com stake > 0
    for (const ev of [1e-2, 1e-3, 1e-4, 1e-6, 1e-8, 1e-10, 1e-11]) {
      const odd = 2;
      const p = (1 + ev) / odd;
      const s = autorizarStake({ p, odd, ...ok });
      expect(s.autorizada).toBe(true);
      expect(s.fracaoBanca).toBeGreaterThan(0);
      // Kelly cheio = ev/(odd − 1): confere a ordem de grandeza (não é só "positivo")
      expect(s.kellyCheio).toBeGreaterThan(ev * 0.9);
      expect(s.kellyCheio).toBeLessThan(ev * 1.1);
    }
  });

  it('abaixo da tolerância (ruído) vira zero; o limite é o 1e-12 documentado', () => {
    expect(kellyCheio((1 + 1e-13) / 2, 2)).toBe(0);
    expect(kellyCheio((1 + 5e-12) / 2, 2)).toBeGreaterThan(0);
    expect(kellyCheio((1 - 1e-13) / 2, 2)).toBe(0);
  });

  it('em odd alta o mesmo critério vale (EV pequeno, b grande)', () => {
    const odd = 11;
    const p = (1 + 1e-9) / odd;
    expect(autorizarStake({ p, odd, ...ok }).fracaoBanca).toBeGreaterThan(0);
    expect(autorizarStake({ p: 1 / odd, odd, ...ok }).fracaoBanca).toBe(0);
  });
});

describe('arredondamento monetário para baixo', () => {
  it('piso ao centavo e nunca acima de banca × fração', () => {
    expect(valorEmReais(100.25, 0.02)).toBe(2);
    expect(valorEmReais(333.33, 0.02)).toBe(6.66);
    expect(valorEmReais(1000, 0.0113636)).toBe(11.36);
    expect(valorEmReais(50, 0.0001)).toBe(0); // abaixo de R$ 0,01
  });

  it('entradas inválidas dão zero, nunca NaN', () => {
    expect(valorEmReais(NaN, 0.01)).toBe(0);
    expect(valorEmReais(1000, NaN)).toBe(0);
    expect(valorEmReais(-10, 0.01)).toBe(0);
    expect(valorEmReais(1000, -0.01)).toBe(0);
    expect(valorEmReais(Infinity, 0.01)).toBe(0);
  });

  it('o valor autorizado nunca passa do teto financeiro (teto × banca)', () => {
    for (const banca of [12.34, 99.99, 100.25, 333.33, 1234.56, 54321.09]) {
      const s = autorizarStake({ p: 0.9, odd: 3, fracaoKelly: 0.25, banca });
      expect(s.fracaoBanca).toBe(0.02);
      expect(s.valor!).toBeLessThanOrEqual(banca * 0.02);
      const lista = autorizarStake({ p: 0.9, odd: 3, fracaoKelly: 0.25, teto: 0.01, banca });
      expect(lista.valor!).toBeLessThanOrEqual(banca * 0.01);
    }
  });

  it('valor abaixo de 1 centavo: a fração continua exata e o valor é 0,00', () => {
    const s = autorizarStake({ p: (1 + 1e-6) / 2, odd: 2, fracaoKelly: 0.125, banca: 100 });
    expect(s.fracaoBanca).toBeGreaterThan(0);
    expect(s.valor).toBe(0);
  });
});
