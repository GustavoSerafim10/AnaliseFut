/**
 * Junção de vários backups: duplicatas contam uma vez, versões diferentes da mesma entrada ficam
 * rastreadas como substituídas, revisões órfãs são excluídas com motivo, e a conservação
 * (físicos = canônicos + duplicatas + substituídos + excluídos) vale sempre.
 */
import { describe, expect, it } from 'vitest';
import { juntarBackups, verificarConservacao } from '../src/leitura/juntarBackups';
import { lerBackup } from '../src/leitura/lerBackup';
import { backupGz, backupV1, backupV2, cenario, comApostaEResultado } from './fixtures/geradores';

const somaOk = (c: {
  fisicos: number;
  canonicos: number;
  duplicatas: number;
  substituidos: number;
  excluidos: number;
}) => c.canonicos + c.duplicatas + c.substituidos + c.excluidos === c.fisicos;

describe('junção', () => {
  it('o mesmo conteúdo em v3, v2 e v1: uma entrada canônica e 4 revisões; o resto é duplicata', async () => {
    const c = await cenario();
    const ls = await Promise.all([
      lerBackup('a.json.gz', await backupGz([c.entrada], c.revisoes)),
      lerBackup('b.json', backupV2([c.entrada], c.revisoes)),
      lerBackup('c.json', backupV1([c.entrada])),
    ]);
    const j = juntarBackups(ls);
    expect(j.entradas).toHaveLength(1);
    expect(j.entradas[0].fontes).toEqual(['a.json.gz', 'b.json', 'c.json']);
    expect(j.evidencias).toHaveLength(4);
    expect(j.conservacao.historico).toEqual({
      fisicos: 3,
      canonicos: 1,
      duplicatas: 2,
      substituidos: 0,
      excluidos: 0,
    });
    expect(j.conservacao.evidencias).toEqual({
      fisicos: 8,
      canonicos: 4,
      duplicatas: 4,
      substituidos: 0,
      excluidos: 0,
    });
    expect(j.conservacao.arquivos).toEqual({ lidos: 3, recusados: 0 });
  });

  it('a ordem dos arquivos não muda nada', async () => {
    const c = await cenario();
    const nova = comApostaEResultado(c.entrada, { oddFechamento: 1.8, fechamentoOutros: [2.1] });
    const a = await lerBackup('a.json.gz', await backupGz([c.entrada], c.revisoes.slice(0, 2)));
    const b = await lerBackup('b.json', backupV2([nova], c.revisoes.slice(1)));
    expect(JSON.stringify(juntarBackups([a, b]))).toBe(JSON.stringify(juntarBackups([b, a])));
  });

  it('versões diferentes da mesma entrada: a mais recente é canônica, a outra fica rastreada', async () => {
    const c = await cenario();
    const nova = comApostaEResultado(c.entrada, { oddFechamento: 1.8 });
    const j = juntarBackups([
      await lerBackup('velho.json', backupV1([c.entrada])),
      await lerBackup('novo.json', backupV1([nova])),
    ]);
    expect(j.entradas).toHaveLength(1);
    expect(j.entradas[0].entrada.resultado?.oddFechamento).toBe(1.8);
    expect(j.entradas[0].versoes).toBe(2);
    expect(j.substituidas).toEqual([
      expect.objectContaining({ id: 'jogo-1', fonte: 'velho.json' }),
    ]);
    expect(j.conservacao.historico).toMatchObject({ fisicos: 2, canonicos: 1, substituidos: 1 });
  });

  it('revisão sem entrada no histórico: órfã, excluída com motivo e contada', async () => {
    const c = await cenario();
    const j = juntarBackups([await lerBackup('a.json.gz', await backupGz([], c.revisoes))]);
    expect(j.evidencias).toEqual([]);
    expect(j.exclusoes.filter((x) => x.categoria === 'evidencia-orfa')).toHaveLength(4);
    expect(j.conservacao.evidencias).toEqual({
      fisicos: 4,
      canonicos: 0,
      duplicatas: 0,
      substituidos: 0,
      excluidos: 4,
    });
  });

  it('entrada malformada e arquivo recusado: exclusões rastreadas, conservação fecha', async () => {
    const c = await cenario();
    const j = juntarBackups([
      await lerBackup('m.json', backupV1([c.entrada, { id: 'sem-resumo' }, 42])),
      await lerBackup('r.json', new TextEncoder().encode('não é json')),
    ]);
    expect(j.entradas).toHaveLength(1);
    expect(j.exclusoes.map((x) => [x.categoria, x.id])).toEqual([
      ['entrada-malformada', 'historico[2]'],
      ['entrada-malformada', 'sem-resumo'],
      ['fonte-recusada', null],
    ]);
    expect(j.conservacao.historico).toEqual({
      fisicos: 3,
      canonicos: 1,
      duplicatas: 0,
      substituidos: 0,
      excluidos: 2,
    });
    expect(j.conservacao.arquivos).toEqual({ lidos: 2, recusados: 1 });
    expect(somaOk(j.conservacao.historico) && somaOk(j.conservacao.evidencias)).toBe(true);
  });

  it('a conservação é verificada: soma que não fecha lança erro', () => {
    expect(() =>
      verificarConservacao('teste', {
        fisicos: 3,
        canonicos: 1,
        duplicatas: 1,
        substituidos: 0,
        excluidos: 0,
      }),
    ).toThrow(/conservação violada/);
  });
});
