/**
 * Banco de evidências quando falha: o histórico nunca depende dele. (A concorrência entre abas
 * e a gravação real foram conferidas num Chrome de verdade: o Node não tem IndexedDB.)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  avisoDeDescarte,
  dependentesDoDesfazer,
  importacoesVivas,
  lotesDoDesfazer,
  motivoParaParar,
  registrarEvidencia,
  tentativasIncorporadas,
  type DiarioImportacao,
} from '../src/armazemEvidencias';
import { derivar } from '../src/dados';
import { rascunhoExemplo } from '../src/exemplo';
import { salvarNoHistorico } from '../src/historico';

afterEach(() => vi.useRealTimers());

describe('falha do banco de evidências', () => {
  it('sem IndexedDB: devolve aviso, não lança, e o histórico já salvo segue intacto', async () => {
    expect(typeof indexedDB).toBe('undefined');
    const r = rascunhoExemplo();
    const d = derivar(r);
    const { lista, id } = salvarNoHistorico([], r, d);
    const antes = JSON.stringify(lista);
    const aviso = await registrarEvidencia(id, r, d, { calculadoEm: { inicio: 'a', fim: 'b' } });
    expect(aviso?.tipo).toBe('falha');
    expect(aviso?.texto).toMatch(/salva no histórico, mas a evidência não foi gravada/);
    expect(JSON.stringify(lista)).toBe(antes);
    expect(lista).toHaveLength(1);
  });

  it('depois do apito: não tenta gravar (nem avisa)', async () => {
    const r = rascunhoExemplo();
    const d = derivar(r);
    vi.useFakeTimers({ now: Date.now() + 4 * 3_600_000, toFake: ['Date'] });
    expect(await registrarEvidencia('x', r, d, { calculadoEm: { inicio: 'a', fim: 'b' } })).toBe(
      null,
    );
  });
});

const diario = (id: string, o: Partial<DiarioImportacao> = {}): DiarioImportacao => ({
  id,
  arquivo: 'backup.json.gz',
  iniciadaEm: 't',
  atualizadaEm: 't',
  esperadas: 150,
  processadas: 0,
  novas: 0,
  jaExistiam: 0,
  renumeradas: 0,
  estado: 'concluida',
  ...o,
});

describe('importação retomada: qual tentativa a conclusão incorpora', () => {
  const nova = diario('nova', { impressao: 'AAA' });

  it('só a do MESMO backup (mesma impressão SHA-256) e que não terminou', () => {
    const todos = [
      diario('mesma-falhou', { impressao: 'AAA', estado: 'falhou', novas: 100 }),
      diario('mesma-andamento', { impressao: 'AAA', estado: 'em-andamento', novas: 20 }),
      diario('mesma-concluida', { impressao: 'AAA', estado: 'concluida' }),
      diario('mesma-desfeita', { impressao: 'AAA', estado: 'desfeita' }),
      nova,
    ];
    expect(tentativasIncorporadas(todos, nova)).toEqual(['mesma-falhou', 'mesma-andamento']);
  });

  it('mesmo nome e mesma contagem, conteúdo diferente: NÃO incorpora', () => {
    const outra = diario('outro-arquivo', { impressao: 'BBB', estado: 'falhou', novas: 100 });
    expect(outra.arquivo).toBe(nova.arquivo);
    expect(outra.esperadas).toBe(nova.esperadas);
    expect(tentativasIncorporadas([outra, nova], nova)).toEqual([]);
  });

  it('diário sem impressão (anterior a ela) nunca é casado por nome e contagem', () => {
    const antiga = diario('antiga', { estado: 'falhou' });
    expect(tentativasIncorporadas([antiga, nova], nova)).toEqual([]);
    expect(tentativasIncorporadas([antiga], diario('sem', {}))).toEqual([]);
  });
});

describe('desfazer: a operação lógica inteira, nada além dela', () => {
  const todos = [
    diario('tentativa', { estado: 'concluida', completadaPor: 'retomada', novas: 100 }),
    diario('retomada', { incorpora: ['tentativa'], novas: 50 }),
    diario('outra-importacao', { novas: 7 }),
  ];
  it('desfazer a retomada leva as tentativas que ela completou', () => {
    expect(lotesDoDesfazer(todos, 'retomada')).toEqual(['retomada', 'tentativa']);
  });
  it('pedir pela tentativa incorporada desfaz a operação inteira', () => {
    expect(lotesDoDesfazer(todos, 'tentativa')).toEqual(['retomada', 'tentativa']);
  });
  it('outras importações não entram', () => {
    expect(lotesDoDesfazer(todos, 'outra-importacao')).toEqual(['outra-importacao']);
    expect(lotesDoDesfazer(todos, 'retomada')).not.toContain('outra-importacao');
  });
  it('lote desconhecido: só ele (nunca "tudo")', () => {
    expect(lotesDoDesfazer(todos, 'xyz')).toEqual(['xyz']);
  });
});

describe('limite de 50: descarte avisado', () => {
  it('diz o jogo, quantas e quais revisões saíram', () => {
    const t = avisoDeDescarte(
      'Remo × Paysandu',
      Array.from({ length: 31 }, (_, i) => i + 2),
    );
    expect(t).toContain(
      'Limite de 50 revisões por jogo: 31 revisão(ões) antiga(s) de Remo × Paysandu',
    );
    expect(t).toMatch(/nº 2 a 32/);
    expect(t).toMatch(/Ficam a 1ª e as 49 mais recentes/);
    expect(avisoDeDescarte('A × B', [2])).toContain('1 revisão(ões) antiga(s) de A × B');
    expect(avisoDeDescarte('A × B', [2])).toContain('(nº 2)');
    expect(avisoDeDescarte('A × B', [2, 5, 9])).toContain('(nº 2, 5 e 9)');
  });
});

describe('concorrência entre abas (P2b)', () => {
  it('tentativa do mesmo backup ainda VIVA em outra aba não é incorporada', () => {
    const nova = diario('nova', { impressao: 'AAA' });
    const todos = [
      diario('viva', { impressao: 'AAA', estado: 'em-andamento', novas: 50 }),
      diario('morta', { impressao: 'AAA', estado: 'em-andamento', novas: 20 }),
      nova,
    ];
    expect(tentativasIncorporadas(todos, nova, new Set(['viva']))).toEqual(['morta']);
    expect(tentativasIncorporadas(todos, nova)).toEqual(['viva', 'morta']);
  });

  it('um lote só grava se o diário no banco ainda está "em andamento"', () => {
    expect(motivoParaParar(diario('x', { estado: 'em-andamento' }))).toBeNull();
    expect(motivoParaParar(diario('x', { estado: 'desfeita' }))).toMatch(/desfeita em outra aba/);
    expect(motivoParaParar(diario('x', { estado: 'concluida', completadaPor: 'y' }))).toMatch(
      /já completou esta/,
    );
    expect(motivoParaParar(diario('x', { estado: 'concluida' }))).toMatch(/já está "concluida"/);
    expect(motivoParaParar(undefined)).toMatch(/não existe mais/);
  });

  it('sem Web Locks (Node, navegador antigo): nenhuma importação é tida como viva', async () => {
    expect(await importacoesVivas()).toEqual(new Set());
  });
});

describe('desfazer: importações que dependiam das revisões removidas (caso C)', () => {
  const todos = [
    diario('f1', { estado: 'falhou', novas: 50 }),
    diario('f2', { novas: 100, jaExistiam: 50, apoio: { f1: 50 } }),
    diario('f3', { novas: 10, apoio: { outra: 4 } }),
    diario('f4-desfeita', { estado: 'desfeita', apoio: { f1: 9 } }),
  ];
  it('lista quem perde revisões e quantas; ignora as desfeitas e as que não dependem', () => {
    expect(dependentesDoDesfazer(todos, ['f1'])).toEqual([
      { id: 'f2', arquivo: 'backup.json.gz', revisoes: 50 },
    ]);
    expect(dependentesDoDesfazer(todos, ['f2'])).toEqual([]);
  });
  it('a própria operação (ela e as tentativas incorporadas) não é dependente de si', () => {
    const op = [diario('ret', { incorpora: ['t'], apoio: { t: 30 } }), diario('t', {})];
    expect(dependentesDoDesfazer(op, ['ret', 't'])).toEqual([]);
  });
});
