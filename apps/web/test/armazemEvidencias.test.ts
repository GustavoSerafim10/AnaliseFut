/**
 * Banco de evidências quando falha: o histórico nunca depende dele. (A concorrência entre abas
 * e a gravação real foram conferidas num Chrome de verdade: o Node não tem IndexedDB.)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aplicarLote,
  avisoDeDescarte,
  dependentesDoDesfazer,
  desfalcadasParaTela,
  motivoRecusaDesfazer,
  reconciliar,
  recomposicaoComprovada,
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

describe('P2c / G1: o lote parte do diário do banco e preserva o desfalque', () => {
  const desfalque = { por: 'x', arquivo: 'f1.json.gz', revisoes: 100, em: 't' };
  it('desfalque marcado por outra aba sobrevive ao lote seguinte; só as contagens mudam', () => {
    const noBanco = diario('y', {
      estado: 'em-andamento',
      processadas: 100,
      jaExistiam: 100,
      apoio: { x: 100 },
      desfalques: [desfalque],
    });
    const depois = aplicarLote(
      noBanco,
      { processadas: 50, novas: 50, jaExistiam: 0, renumeradas: 0, apoio: {} },
      't2',
    );
    expect(depois.desfalques).toEqual([desfalque]);
    expect(depois).toMatchObject({
      processadas: 150,
      novas: 50,
      jaExistiam: 100,
      apoio: { x: 100 },
    });
    expect(depois.estado).toBe('em-andamento');
    expect(depois.atualizadaEm).toBe('t2');
  });
  it('apoio soma por lote, sem perder o que já havia', () => {
    const d = aplicarLote(
      diario('y', { apoio: { a: 2 } }),
      { processadas: 5, novas: 0, jaExistiam: 5, renumeradas: 0, apoio: { a: 3, b: 2 } },
      't',
    );
    expect(d.apoio).toEqual({ a: 5, b: 2 });
  });
  it('importação que terminou com desfalque continua aparecendo na tela', () => {
    expect(
      desfalcadasParaTela([diario('y', { estado: 'concluida', desfalques: [desfalque] })]),
    ).toHaveLength(1);
  });
});

describe('P2c / G2: a marca só sai com a recomposição comprovada', () => {
  const desfalque = { por: 'x', arquivo: 'f1.json.gz', revisoes: 100, em: 't' };
  const completa = diario('b', {
    estado: 'em-andamento',
    impressao: 'AAA',
    esperadas: 150,
    processadas: 150,
    novas: 150,
  });
  it('comprovada: mesmo backup, todas as revisões tratadas e nenhum desfalque próprio', () => {
    expect(recomposicaoComprovada(completa)).toBe(true);
    expect(recomposicaoComprovada({ ...completa, processadas: 149 })).toBe(false);
    expect(recomposicaoComprovada({ ...completa, impressao: undefined })).toBe(false);
    expect(recomposicaoComprovada({ ...completa, desfalques: [desfalque] })).toBe(false);
    expect(recomposicaoComprovada({ ...completa, estado: 'desfeita' })).toBe(false);
  });
  it('tentativa incorporada com desfalque: comprovada → limpa e registra quem recompôs', () => {
    const a1 = diario('a1', { estado: 'falhou', impressao: 'AAA', desfalques: [desfalque] });
    const r = reconciliar(a1, completa, true, 't2');
    expect(r.desfalques).toBeUndefined();
    expect(r.recompostaPor).toBe('b');
    expect(r.apoio).toEqual({ b: 150 });
  });
  it('sem comprovação a marca fica', () => {
    const a1 = diario('a1', { estado: 'falhou', desfalques: [desfalque] });
    expect(reconciliar(a1, completa, false, 't2').desfalques).toEqual([desfalque]);
  });
  it('a tela nunca mostra tentativa incorporada como desfalcada', () => {
    const incorporada = diario('a1', {
      estado: 'concluida',
      completadaPor: 'b',
      desfalques: [desfalque],
    });
    expect(desfalcadasParaTela([incorporada])).toEqual([]);
  });
});

describe('P2c: desfazer recusado diz qual importação precisa terminar', () => {
  const todos = [
    diario('raiz', { incorpora: ['t'] }),
    diario('t', { estado: 'concluida', completadaPor: 'raiz' }),
    diario('dep', { arquivo: 'dep.json.gz', estado: 'em-andamento', apoio: { raiz: 3 } }),
    diario('outra', { arquivo: 'outra.json.gz', estado: 'em-andamento' }),
  ];
  it('nomeia cada importação rodando e o papel dela', () => {
    const m = motivoRecusaDesfazer(todos, new Set(['dep', 'outra']), ['raiz', 't']);
    expect(m).toContain('"dep.json.gz" (depende das revisões desta)');
    expect(m).toContain('"outra.json.gz" (pode passar a depender delas até terminar)');
    expect(m).toContain('nada foi apagado');
  });
  it('parte da própria operação rodando também é nomeada', () => {
    const m = motivoRecusaDesfazer(
      [...todos.slice(0, 1), diario('t', { arquivo: 'f.json.gz', estado: 'em-andamento' })],
      new Set(['t']),
      ['raiz', 't'],
    );
    expect(m).toContain('"f.json.gz" (parte desta importação)');
  });
});
