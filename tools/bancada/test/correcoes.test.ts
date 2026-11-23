/**
 * Rodada de correções da F1.1 (revisão de 23/11/2026):
 *  1. versão canônica pelo INSTANTE (Date.parse), com datas inválidas marcadas, nunca escolha muda;
 *  2. v3 com "historico" que não é lista: recusado com motivo;
 *  3. lista "Melhores entradas" vinda de evidência REAL do fluxo de gravação;
 *  4. revisões de análise sem chave de jogo registradas uma a uma.
 */
import { describe, expect, it } from 'vitest';
import type { EntradaHistorico } from '../../../apps/web/src/historico';
import { montarConjunto } from '../src/index';
import { juntarBackups } from '../src/leitura/juntarBackups';
import { lerBackup } from '../src/leitura/lerBackup';
import { montarSelecoes } from '../src/normalizar/selecoes';
import { backupGz, backupV1, cenario, cenarioComLista } from './fixtures/geradores';

const juntarV1 = async (pares: [string, EntradaHistorico][]) =>
  juntarBackups(await Promise.all(pares.map(([n, e]) => lerBackup(n, backupV1([e])))));

describe('1. versão canônica pelo instante', () => {
  it('"-03:00" × "Z": vence a mais recente no tempo, não a maior no texto', async () => {
    const { entrada: e } = await cenario();
    // 20:00-03:00 = 23:00Z, DEPOIS de 22:00Z — mas "…T20…" < "…T22…" como texto
    const nova = { ...e, salvoEm: '2026-11-18T20:00:00-03:00', manual: 'green' as const };
    const velha = { ...e, salvoEm: '2026-11-18T22:00:00Z' };
    const j = await juntarV1([
      ['velha.json', velha],
      ['nova.json', nova],
    ]);
    expect(j.entradas[0].entrada.salvoEm).toBe('2026-11-18T20:00:00-03:00');
    expect(j.entradas[0]).toMatchObject({ criterio: 'recencia', alerta: null, versoes: 2 });
    expect(j.substituidas).toEqual([
      expect.objectContaining({
        fonte: 'velha.json',
        criterio: 'recencia',
        // valor original preservado, sem conversão
        datas: { registradoEm: null, feitaEm: null, salvoEm: '2026-11-18T22:00:00Z' },
      }),
    ]);
  });

  it('o resultado registrado decide antes do salvamento (ordem dos campos mantida)', async () => {
    const { entrada: e } = await cenario();
    const comResultado = {
      ...e,
      salvoEm: '2026-11-18T10:00:00Z',
      resultado: { casa: 1, fora: 0, registradoEm: '2026-11-18T23:00:00Z' },
    };
    const soSalva = { ...e, salvoEm: '2026-11-19T10:00:00Z' };
    const j = await juntarV1([
      ['a.json', soSalva],
      ['b.json', comResultado],
    ]);
    expect(j.entradas[0].entrada.resultado?.casa).toBe(1);
  });

  it('data inválida: canônica por desempate, MARCADA com alerta e o valor original', async () => {
    const { entrada: e } = await cenario();
    const ruim = { ...e, salvoEm: 'ontem à noite' };
    const boa = { ...e, salvoEm: '2026-11-18T22:00:00Z', manual: 'red' as const };
    const j = await juntarV1([
      ['ruim.json', ruim],
      ['boa.json', boa],
    ]);
    expect(j.entradas[0].criterio).toBe('desempate-por-conteudo');
    expect(j.entradas[0].alerta).toContain('salvoEm="ontem à noite"');
    expect(j.substituidas[0].criterio).toBe('desempate-por-conteudo');
    expect(j.substituidas[0].motivo).toContain('não comprovada');
    expect(j.conservacao.historico).toMatchObject({ fisicos: 2, canonicos: 1, substituidos: 1 });
    // determinístico mesmo assim: a ordem dos arquivos não muda a escolha
    const k = await juntarV1([
      ['boa.json', boa],
      ['ruim.json', ruim],
    ]);
    expect(k.entradas[0].entrada).toEqual(j.entradas[0].entrada);
  });

  it('mesmo instante em formatos diferentes e conteúdo diferente: empate marcado', async () => {
    const { entrada: e } = await cenario();
    const j = await juntarV1([
      ['a.json', { ...e, salvoEm: '2026-11-18T19:00:00-03:00' }],
      ['b.json', { ...e, salvoEm: '2026-11-18T22:00:00.000Z', manual: 'green' }],
    ]);
    expect(j.entradas[0].criterio).toBe('desempate-por-conteudo');
    expect(j.entradas[0].alerta).toContain('mesmas datas');
  });

  it('uma versão só: critério "unica", sem alerta', async () => {
    const { entrada: e } = await cenario();
    const j = await juntarV1([['a.json', e]]);
    expect(j.entradas[0]).toMatchObject({ criterio: 'unica', alerta: null, versoes: 1 });
  });
});

describe('2. v3 com "historico" que não é lista', () => {
  it.each([[{ id: 'x' }], [null], ['texto']])(
    'historico = %j: arquivo recusado com motivo explícito',
    async (h) => {
      const { revisoes } = await cenario();
      const b = await backupGz(h as unknown as unknown[], revisoes);
      const l = await lerBackup('h.json.gz', b);
      expect(l.fonte.recusada).toBe(true);
      // o verificador da Fase 0 já recusa ("cabeçalho sem historico"); a guarda da bancada
      // repete a regra sem o antigo recurso de lista vazia
      expect(l.fonte.motivosRecusa).toHaveLength(1);
      expect(l.fonte.motivosRecusa[0]).toMatch(/cabeçalho (sem|com) "historico"/);
      expect(l.historico).toEqual([]);
      expect(l.evidencias).toEqual([]);
      expect(l.exclusoes).toEqual([
        expect.objectContaining({ categoria: 'fonte-recusada', fonte: 'h.json.gz' }),
      ]);
    },
  );
});

describe('3. lista "Melhores entradas" de evidência real', () => {
  it('a evidência gravada pelo fluxo do site traz a lista; a bancada junta com a V4', async () => {
    const c = await cenarioComLista();
    const gravada = (
      c.revisoes[2].conteudo.avaliacao as {
        entradas: { entradas: { chave: string; odd: number; casa: string }[] };
      }
    ).entradas.entradas;
    // prova de que a lista veio do derivar(), não de edição manual
    expect(gravada.map((x) => [x.chave, x.odd, x.casa])).toEqual([
      ['total|FT|-|2.5|over', 1.9, 'Superbet'],
    ]);

    const k = await montarConjunto([
      { nome: 'lista.json.gz', bytes: await backupGz([c.entrada], c.revisoes) },
    ]);
    const s = k.selecoes.find((x) => x.chave === 'total|FT|-|2.5|over')!;
    expect(s).toMatchObject({
      origem: 'v4+lista',
      camadas: { betV4: true, noBetPapel: false, lista: true },
      melhorOdd: 1.9,
      faixaDecisao: '1,80–2,00',
    });
    expect(s.lista).toMatchObject({ odd: 1.9, casa: 'Superbet' });
    expect(s.lista?.chance).toBeGreaterThan(0);
    expect(s.lista?.chance).toBeLessThan(1);
    expect(s.lista?.pModelo).toBeCloseTo(0.5324892117167118, 9);
    // as outras avaliadas da V4 não estão na lista
    expect(k.selecoes.filter((x) => x.camadas.lista)).toHaveLength(1);
    expect(montarSelecoes(c.entrada, 'k', c.revisoes[2])).toHaveLength(k.selecoes.length);
  });
});

describe('4. revisões de análise sem chave de jogo', () => {
  it('cada revisão não aproveitada vira uma exclusão própria, com arquivo e motivo', async () => {
    const c = await cenario();
    const sem = { ...structuredClone(c.entrada), id: 'sem-chave' };
    sem.resumo.inicio = 'sem horário';
    const revs = c.revisoes.map((r) => ({ ...r, meta: { ...r.meta, idJogo: 'sem-chave' } }));
    const k = await montarConjunto([{ nome: 's.json.gz', bytes: await backupGz([sem], revs) }]);
    expect(k.analises).toEqual([]);
    const ex = k.exclusoes.filter((x) => x.categoria === 'evidencia-de-analise-sem-chave');
    expect(ex).toHaveLength(4);
    expect(new Set(ex.map((x) => x.id)).size).toBe(4);
    for (const x of ex) {
      expect(x.fonte).toBe('s.json.gz');
      expect(x.motivo).toMatch(/^revisão [1-4] não aproveitada: a análise sem-chave/);
      expect(JSON.parse(x.id!)[0]).toBe('sem-chave');
    }
    expect(k.exclusoes.filter((x) => x.categoria === 'jogo-sem-chave')).toHaveLength(1);
    expect(k.conservacao.normalizacao).toMatchObject({
      entradasCanonicas: 1,
      analises: 0,
      semChaveDeJogo: 1,
      evidenciasCanonicas: 4,
      evidenciasEmAnalises: 0,
      evidenciasDeAnaliseExcluida: 4,
    });
  });
});
