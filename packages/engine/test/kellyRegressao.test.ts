/**
 * Regressão do Kelly (Passo 3). Só auditoria: nada aqui altera ou "conserta" a implementação.
 *
 * Três tipos de teste:
 *  - APROVADO: o comportamento atual está correto e fica travado.
 *  - DIVERGÊNCIA: o comportamento atual é discutível; o teste CARACTERIZA o que acontece hoje
 *    (para não passar despercebido) e deve ser atualizado se uma correção for autorizada.
 *  - MEDIÇÃO: trava o resultado de uma metodologia (não prova correção; ver comentários).
 *
 * Referência matemática: Kelly (1956), maximizar E[ln W]; Thorp (2006), "The Kelly Criterion in
 * Blackjack, Sports Betting and the Stock Market" (resultados com vários desfechos e Kelly
 * fracionado); MacLean, Thorp & Ziemba (2011), "The Kelly Capital Growth Investment Criterion".
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STAKE_ENTRADA } from '../src/entradas';
import {
  calcularStake,
  fracaoKelly,
  kellyCheio,
  limitarLote,
  MAX_POR_APOSTA,
  MAX_POR_LOTE,
} from '../src/kelly';
import type { DQ, LinhaOdd, TipoMercado } from '../src/tipos';
import { analisarV4, KELLY_V4, TETO_APOSTA_V4 } from '../src/v4';

// ───────────────────────── solver de referência (independente do código de produção)

/** Desfechos por unidade apostada: ganho, meio-ganho, push, meia-perda, perda (somam 1). */
interface Desfechos {
  g: number;
  mg: number;
  push: number;
  mp: number;
}
const perdaDe = (d: Desfechos) => 1 - d.g - d.mg - d.push - d.mp;

/** crescimento esperado do log da banca ao apostar a fração f */
function crescimento(d: Desfechos, odd: number, f: number): number {
  const b = odd - 1;
  return (
    d.g * Math.log(1 + f * b) +
    d.mg * Math.log(1 + (f * b) / 2) +
    d.mp * Math.log(1 - f / 2) +
    perdaDe(d) * Math.log(1 - f)
  );
}

/** derivada de G(f); o push soma zero ao crescimento e some da derivada */
function derivada(d: Desfechos, odd: number, f: number): number {
  const b = odd - 1;
  return (
    (d.g * b) / (1 + f * b) +
    (d.mg * (b / 2)) / (1 + (f * b) / 2) -
    d.mp / 2 / (1 - f / 2) -
    perdaDe(d) / (1 - f)
  );
}

/** fração ótima exata (G é côncava: a derivada cruza o zero uma vez; bissecção). 0 se G'(0) ≤ 0 */
function fracaoOtima(d: Desfechos, odd: number): number {
  if (derivada(d, odd, 0) <= 0) return 0;
  let lo = 0;
  let hi = 1 - 1e-12;
  for (let i = 0; i < 200; i++) {
    const m = (lo + hi) / 2;
    if (derivada(d, odd, m) > 0) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/** o que o código faz: probabilidade efetiva (binária) → Kelly cheio */
function kellyBinarioDe(d: Desfechos, odd: number): number {
  const a = d.g + d.mg / 2;
  const b = perdaDe(d) + d.mp / 2;
  return Math.max(0, kellyCheio(a / (a + b), odd));
}

// ───────────────────────── APROVADOS

describe('APROVADO · Kelly cheio', () => {
  it('f* = (b·p − q) / b, com valores conhecidos', () => {
    expect(kellyCheio(0.55, 2)).toBeCloseTo(0.1, 12); // (1·.55 − .45) / 1
    expect(kellyCheio(0.6, 1.8)).toBeCloseTo(0.1, 12); // (.8·.6 − .4) / .8
    expect(kellyCheio(0.5, 2)).toBe(0);
    expect(kellyCheio(0.4, 2)).toBeCloseTo(-0.2, 12);
  });

  it('é idêntico a (p·odd − 1) / (odd − 1) em toda a faixa válida', () => {
    for (let p = 0.02; p < 1; p += 0.02)
      for (const odd of [1.05, 1.4, 1.8, 2, 2.5, 3.5, 6, 12, 25])
        expect(kellyCheio(p, odd)).toBeCloseTo((p * odd - 1) / (odd - 1), 12);
  });

  it('o sinal do Kelly é o sinal do EV (p·odd − 1)', () => {
    for (let p = 0.05; p < 1; p += 0.05)
      for (const odd of [1.3, 1.9, 2.7, 5, 11]) {
        const ev = p * odd - 1;
        if (Math.abs(ev) < 1e-9) continue; // a fronteira tem teste próprio
        expect(Math.sign(kellyCheio(p, odd))).toBe(Math.sign(ev));
      }
  });

  it('é o ponto que maximiza o crescimento esperado do log da banca (aposta binária)', () => {
    for (const [p, odd] of [
      [0.55, 2],
      [0.62, 1.7],
      [0.3, 4.2],
      [0.12, 11],
    ]) {
      const d: Desfechos = { g: p, mg: 0, push: 0, mp: 0 };
      expect(kellyCheio(p, odd)).toBeCloseTo(fracaoOtima(d, odd), 9);
    }
  });
});

describe('APROVADO · seleção da fração (1/4 × 1/8)', () => {
  const dqs: DQ[] = ['A', 'B', 'C', 'D', 'E'];
  const classes = ['ROBUSTA', 'MODERADA', 'FRÁGIL'] as const;
  it('1/4 só com DQ A ou B, ROBUSTA e escalação certa; todo o resto 1/8 (30 combinações)', () => {
    for (const dq of dqs)
      for (const classe of classes)
        for (const incerta of [false, true]) {
          const esperado =
            (dq === 'A' || dq === 'B') && classe === 'ROBUSTA' && !incerta ? 0.25 : 0.125;
          expect(fracaoKelly(dq, classe, incerta)).toBe(esperado);
        }
  });

  it('aplica a fração sobre o Kelly cheio', () => {
    const forte = calcularStake({ p: 0.6, odd: 2, dq: 'A', classe: 'ROBUSTA' }); // k = 0.2
    expect(forte.kellyCheio).toBeCloseTo(0.2, 12);
    expect(forte.fracaoKelly).toBe(0.25);
    expect(forte.fracaoBanca).toBeCloseTo(0.05 > MAX_POR_APOSTA ? MAX_POR_APOSTA : 0.05, 12);
    const fraca = calcularStake({ p: 0.53, odd: 2, dq: 'C', classe: 'MODERADA' }); // k = 0.06
    expect(fraca.fracaoKelly).toBe(0.125);
    expect(fraca.fracaoBanca).toBeCloseTo(0.06 * 0.125, 12);
    expect(fraca.limitadaPeloTeto).toBe(false);
  });
});

describe('APROVADO · limites de exposição', () => {
  it('teto de 2% por aposta, com o aviso de que foi limitada', () => {
    expect(MAX_POR_APOSTA).toBe(0.02);
    const s = calcularStake({ p: 0.8, odd: 2.5, dq: 'A', classe: 'ROBUSTA' });
    expect(s.fracaoBanca).toBe(0.02);
    expect(s.limitadaPeloTeto).toBe(true);
  });

  it('o teto vale exatamente na fronteira (bruta = 2% não é "limitada")', () => {
    // k = 0.08 com 1/4 → 0.02 exato
    const s = calcularStake({ p: 0.54, odd: 2, dq: 'A', classe: 'ROBUSTA' });
    expect(s.fracaoBanca).toBeCloseTo(0.02, 12);
    expect(s.limitadaPeloTeto).toBe(s.kellyCheio * 0.25 > MAX_POR_APOSTA);
  });

  it('lote: até 5% passa inalterado; acima disso reduz proporcionalmente para exatamente 5%', () => {
    expect(MAX_POR_LOTE).toBe(0.05);
    expect(limitarLote([0.02, 0.02, 0.01])).toEqual([0.02, 0.02, 0.01]);
    const r = limitarLote([0.04, 0.03, 0.03]);
    expect(r.reduce((s, x) => s + x, 0)).toBeCloseTo(0.05, 12);
    expect(r[0] / r[1]).toBeCloseTo(0.04 / 0.03, 12); // mantém as proporções
    expect(limitarLote([])).toEqual([]);
    expect(limitarLote([0.02, 0.03], 0)).toEqual([0, 0]);
  });

  it('não devolve a mesma lista (sem alias) quando está dentro do limite', () => {
    const entrada = [0.01, 0.02];
    expect(limitarLote(entrada)).not.toBe(entrada);
  });
});

describe('APROVADO · EV nulo ou negativo: stake zero', () => {
  it('EV claramente negativo ou nulo dá fração e valor zero', () => {
    for (const [p, odd] of [
      [0.4, 2],
      [0.5, 2],
      [0.25, 4],
      [0.1, 10],
      [0.2, 5],
      [0.3, 3],
    ] as [number, number][]) {
      const s = calcularStake({ p, odd, dq: 'A', classe: 'ROBUSTA', banca: 1000 });
      expect(s.fracaoBanca).toBe(0);
      expect(s.valor).toBe(0);
      expect(s.limitadaPeloTeto).toBe(false);
    }
  });

  it('sem banca informada, não há valor em R$', () => {
    expect(calcularStake({ p: 0.6, odd: 2, dq: 'A', classe: 'ROBUSTA' }).valor).toBeUndefined();
  });
});

describe('APROVADO · stake da V4 (caminho que decide BET)', () => {
  const JOGO = { casa: 'A', fora: 'B', inicio: '2026-10-26T20:00:00-03:00' };
  const AGORA = '2026-10-26T16:00:00-03:00';
  const par = (casa: string, o: number, u: number): LinhaOdd[] =>
    (['over', 'under'] as const).map((lado, i) => ({
      casa,
      mercado: 'total' as TipoMercado,
      lado,
      odd: i === 0 ? o : u,
      linha: 2.5,
      periodo: 'FT',
      horarioColeta: '2026-10-26T16:00:00-03:00',
    }));

  it('R1: Kelly cheio de P_true e odd × 1/4, abaixo do teto', () => {
    const r = analisarV4({
      jogo: JOGO,
      agora: AGORA,
      ligaPrincipal: true,
      banca: 1000,
      linhas: [...par('Pinnacle', 1.95, 1.95), ...par('1win', 2.1, 1.72)],
    });
    expect(r.decisao).toBe('BET');
    const st = r.melhor!.stake!;
    const k = (0.5 * 2.1 - 1) / (2.1 - 1);
    expect(st.kellyCheio).toBeCloseTo(k, 12);
    expect(st.fracaoKelly).toBe(KELLY_V4.R1);
    expect(st.fracaoBanca).toBeCloseTo(k * 0.25, 12);
    expect(st.valor).toBe(Math.round(1000 * k * 0.25 * 100) / 100);
  });

  it('R2: 1/6 de Kelly', () => {
    const r = analisarV4({
      jogo: JOGO,
      agora: AGORA,
      ligaPrincipal: true,
      banca: 1000,
      linhas: [
        ...par('Bet365', 1.9, 1.9),
        ...par('Superbet', 1.9, 1.9),
        ...par('1win', 1.9, 1.9),
        ...par('Betano', 2.12, 1.8),
      ],
    });
    const st = r.melhor!.stake!;
    expect(st.fracaoKelly).toBeCloseTo(KELLY_V4.R2, 12);
    expect(st.fracaoBanca).toBeCloseTo(((0.5 * 2.12 - 1) / 1.12) * KELLY_V4.R2, 12);
  });

  it('a V4 só chega a stake com EV positivo (Kelly > 0 sempre que há BET)', () => {
    const r = analisarV4({
      jogo: JOGO,
      agora: AGORA,
      ligaPrincipal: true,
      banca: 1000,
      linhas: [...par('Pinnacle', 1.95, 1.95), ...par('1win', 1.9, 1.9)],
    });
    expect(r.decisao).toBe('NO_BET');
    expect(r.melhor?.stake ?? null).toBeNull();
  });
});

// ───────────────────────── DIVERGÊNCIAS (caracterização do comportamento ATUAL)

describe('DIVERGÊNCIA · EV exatamente zero pode virar stake ~1e-17 (não zero exato)', () => {
  it('p = 0,4 e odd = 2,5: o ponto flutuante dá Kelly de 7e-17', () => {
    const k = kellyCheio(0.4, 2.5);
    expect(k).toBeGreaterThan(0);
    expect(k).toBeLessThan(1e-15);
    const s = calcularStake({ p: 0.4, odd: 2.5, dq: 'A', classe: 'ROBUSTA', banca: 1000 });
    expect(s.fracaoBanca).toBeGreaterThan(0); // "obrigatoriamente zero" não vale na fronteira
    expect(s.fracaoBanca).toBeLessThan(1e-15);
    expect(s.valor).toBe(0); // o arredondamento a centavos esconde isso no valor em R$
  });
});

describe('DIVERGÊNCIA · entradas inválidas não são recusadas por kelly.ts', () => {
  const stake = (p: number, odd: number) =>
    calcularStake({ p, odd, dq: 'A', classe: 'ROBUSTA', banca: 1000 });

  it('odd ≤ 1 com b negativo ou nulo: pode gerar stake POSITIVA (2%) ou NaN', () => {
    expect(stake(0.5, 0.5).fracaoBanca).toBe(0.02); // odd < 1
    expect(stake(0.5, 0).fracaoBanca).toBe(0.02);
    expect(stake(0.5, -2).fracaoBanca).toBe(0.02);
    expect(stake(1, 1).fracaoBanca).toBeNaN(); // 0/0
    expect(stake(0.5, 1).fracaoBanca).toBe(0); // −∞ vira zero por acaso
  });

  it('NaN e Infinity propagam para a stake (Math.max(0, NaN) = NaN)', () => {
    expect(stake(NaN, 2).fracaoBanca).toBeNaN();
    expect(stake(0.5, NaN).fracaoBanca).toBeNaN();
    expect(stake(0.5, Infinity).fracaoBanca).toBeNaN();
    expect(stake(0.5, NaN).valor).toBeNaN();
  });

  it('probabilidade fora de [0,1] não é validada: p ≥ 1 dá o teto de 2%', () => {
    expect(stake(1.2, 2).fracaoBanca).toBe(0.02);
    expect(stake(1, 2).fracaoBanca).toBe(0.02);
    expect(stake(-0.1, 2).fracaoBanca).toBe(0);
  });
});

describe('DIVERGÊNCIA · valor em R$ pode passar do teto em até meio centavo', () => {
  it('o valor é arredondado ao centavo MAIS PRÓXIMO, não para baixo', () => {
    const s = calcularStake({ p: 0.9, odd: 2, dq: 'A', classe: 'ROBUSTA', banca: 100.25 });
    expect(s.fracaoBanca).toBe(0.02);
    expect(s.valor).toBe(2.01);
    expect(s.valor!).toBeGreaterThan(100.25 * 0.02); // teto exato = 2,005
  });
  it('o excesso nunca passa de meio centavo', () => {
    for (const banca of [12.345, 50.25, 77.77, 100.25, 333.33, 999.99]) {
      const s = calcularStake({ p: 0.9, odd: 2, dq: 'A', classe: 'ROBUSTA', banca });
      expect(s.valor! - banca * 0.02).toBeLessThanOrEqual(0.005 + 1e-9);
    }
  });
});

describe('DIVERGÊNCIA · limitarLote não valida os valores', () => {
  it('NaN contamina o lote inteiro', () => {
    expect(limitarLote([0.03, NaN, 0.04]).every(Number.isNaN)).toBe(true);
  });
  it('fração negativa é aceita e entra na soma', () => {
    const r = limitarLote([0.06, -0.02, 0.04]);
    expect(r[1]).toBeLessThan(0);
    expect(r.reduce((s, x) => s + x, 0)).toBeCloseTo(0.05, 12);
  });
});

describe('APROVADO · DQ D e E não autorizam exposição (Etapa 3A)', () => {
  it('a camada que autoriza zera a stake, mesmo com vantagem grande', () => {
    expect(fracaoKelly('D', 'ROBUSTA')).toBe(0.125);
    for (const dq of ['D', 'E'] as const) {
      const s = calcularStake({ p: 0.6, odd: 2, dq, classe: 'ROBUSTA', banca: 1000 });
      expect(s.fracaoBanca).toBe(0);
      expect(s.valor).toBe(0);
    }
  });
});

describe('DIVERGÊNCIA · há duas políticas de teto e a lista de entradas não usa Kelly', () => {
  it('V4 em R3 limita a 1% por aposta; kelly.ts limita a 2%', () => {
    expect(TETO_APOSTA_V4.R3).toBe(0.01);
    expect(MAX_POR_APOSTA).toBe(0.02);
    expect(TETO_APOSTA_V4.R1).toBe(MAX_POR_APOSTA);
  });

  it('"Melhores entradas" aposta 1% fixo, sem Kelly: acima do 1/4 Kelly quando a vantagem é pequena', () => {
    expect(STAKE_ENTRADA).toBe(0.01);
    // o caso real da tela: chance efetiva 51,2% na odd 2,00 (EV de cerca de +1,9% já com a devolução)
    const quartoKelly = kellyCheio(0.512, 2) * 0.25;
    expect(quartoKelly).toBeCloseTo(0.006, 3);
    expect(STAKE_ENTRADA).toBeGreaterThan(quartoKelly);
    // com vantagem de 0,5% o Kelly pede ~0,1% e a lista continua em 1%
    expect(STAKE_ENTRADA / (kellyCheio(0.5025, 2) * 0.25)).toBeGreaterThan(5);
  });

  it('o limite de 5% por lote existe em kelly.ts mas nenhum outro código o chama', () => {
    const achados: string[] = [];
    const varrer = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const p = join(dir, nome);
        if (statSync(p).isDirectory()) {
          if (nome !== 'node_modules' && nome !== 'dist') varrer(p);
        } else if (/\.(ts|tsx)$/.test(nome) && !p.includes('test') && !p.endsWith('kelly.ts')) {
          if (readFileSync(p, 'utf8').includes('limitarLote(')) achados.push(p);
        }
      }
    };
    varrer(join(__dirname, '..', '..'));
    varrer(join(__dirname, '..', '..', '..', 'apps', 'web', 'src'));
    expect(achados).toEqual([]);
  });
});

// ───────────────────────── MEDIÇÃO: a grade de 63 e a aproximação do Kelly binário

describe('MEDIÇÃO · Kelly binário × exato em linhas de quarto', () => {
  /**
   * Metodologia (a mesma da auditoria anterior):
   *  - grade: odd ∈ {1,5; 1,8; 2,0; 2,5; 3,5} × ganho ∈ {25,35,45%} × meio-ganho ∈ {5,10,20%} ×
   *    meia-perda ∈ {5,10,20%} = 135 combinações; ficam as 63 com perda > 5% e Kelly exato ≥ 0,2%.
   *  - "exato": fração que maximiza E[ln W] com os cinco desfechos (bissecção na derivada).
   *  - "binário": o que o código faz (probabilidade efetiva a/(a+b) → (p·odd − 1)/(odd − 1)).
   *  - erro = |binário − exato| / exato, relativo ao Kelly CHEIO (antes da fração 1/4 ou 1/8).
   * Isto mede uma aproximação numa grade escolhida; não demonstra que o motor está correto.
   */
  function medir(casos: Desfechos[], odds: number[], filtro: (d: Desfechos) => boolean) {
    const erros: number[] = [];
    const perdas: number[] = [];
    let superaExato = 0;
    for (const odd of odds)
      for (const d of casos) {
        if (!filtro(d)) continue;
        const exato = fracaoOtima(d, odd);
        if (exato < 0.002) continue;
        const bin = kellyBinarioDe(d, odd);
        erros.push(Math.abs(bin - exato) / exato);
        perdas.push(crescimento(d, odd, exato) - crescimento(d, odd, bin));
        if (bin > exato + 1e-12) superaExato++;
      }
    const media = erros.reduce((s, x) => s + x, 0) / erros.length;
    return {
      n: erros.length,
      media,
      pior: Math.max(...erros),
      superaExato,
      perdaMax: Math.max(...perdas),
    };
  }

  const odds63 = [1.5, 1.8, 2.0, 2.5, 3.5];
  const grade63: Desfechos[] = [];
  for (const g of [0.25, 0.35, 0.45])
    for (const mg of [0.05, 0.1, 0.2])
      for (const mp of [0.05, 0.1, 0.2]) grade63.push({ g, mg, push: 0, mp });

  it('reproduz a grade de 63: erro médio 7,8% e pior caso 16,3% do Kelly cheio', () => {
    const r = medir(grade63, odds63, (d) => perdaDe(d) > 0.05);
    expect(r.n).toBe(63);
    expect(r.media).toBeGreaterThan(0.077);
    expect(r.media).toBeLessThan(0.079);
    expect(r.pior).toBeGreaterThan(0.162);
    expect(r.pior).toBeLessThan(0.165);
  });

  it('em nenhum dos 63 casos o binário aposta MAIS que o exato; a perda de crescimento é de 2ª ordem', () => {
    const r = medir(grade63, odds63, (d) => perdaDe(d) > 0.05);
    expect(r.superaExato).toBe(0);
    expect(r.perdaMax).toBeLessThan(0.01); // pior caso: ~0,56% de log-crescimento por aposta
  });

  it('a grade é artificial: mistura meio-ganho e meia-perda, o que uma linha de quarto não tem', () => {
    // numa linha x,25 existe UM tipo de meio resultado. Grade realista: um de cada vez.
    const gs = [0.2, 0.3, 0.4, 0.5, 0.6];
    const ms = [0.05, 0.1, 0.15, 0.2, 0.3];
    const odds = [1.4, 1.6, 1.8, 2.0, 2.4, 3.0, 4.0];
    const soMeioGanho: Desfechos[] = [];
    const soMeiaPerda: Desfechos[] = [];
    for (const g of gs)
      for (const m of ms) {
        soMeioGanho.push({ g, mg: m, push: 0, mp: 0 });
        soMeiaPerda.push({ g, mg: 0, push: 0, mp: m });
      }
    const ganho = medir(soMeioGanho, odds, (d) => perdaDe(d) > 0.05);
    const perda = medir(soMeiaPerda, odds, (d) => perdaDe(d) > 0.05);
    // medido hoje: meio-ganho média 3,6% / pior 14,4%; meia-perda média 5,7% / pior 19,7%
    expect(ganho.media).toBeLessThan(0.05);
    expect(ganho.pior).toBeLessThan(0.16);
    expect(perda.media).toBeLessThan(0.07);
    expect(perda.pior).toBeGreaterThan(0.16); // o pior caso REALISTA é pior que o da grade de 63
    expect(perda.pior).toBeLessThan(0.21);
    expect(ganho.superaExato + perda.superaExato).toBe(0);
  });

  it('push inteiro: o Kelly binário é exato (o push só reescala as probabilidades)', () => {
    const casos: Desfechos[] = [];
    for (const g of [0.2, 0.35, 0.5])
      for (const push of [0.05, 0.15, 0.25]) casos.push({ g, mg: 0, push, mp: 0 });
    const r = medir(casos, [1.5, 2, 2.8, 4], (d) => perdaDe(d) > 0.05);
    expect(r.n).toBeGreaterThan(10);
    expect(r.pior).toBeLessThan(1e-9);
  });
});
