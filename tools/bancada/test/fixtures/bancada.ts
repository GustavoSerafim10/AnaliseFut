/**
 * Cenário sintético da F1.2c: backups (v3 com evidência + v1 sem) cobrindo todos os universos e
 * casos de consolidação. Tudo gerado com as funções do site; nenhum dado real.
 *
 *  jogo-r     análise com evidência: rev. 1 (decisão, antes do apito) + rev. 2 DEPOIS do apito,
 *             adulterada (se a consolidação usasse a última revisão, sairia divergente)
 *  so-pos     análise com evidência só depois do apito → sem-revisao-de-decisao
 *  h1         análise sem evidência → reprocessamento (relógio inferido)
 *  h1-irma    aposta irmã de h1 (com aposta feita) → herda de h1
 *  orfa-irma  irmã de uma raiz que não existe → vínculo não resolvido
 *  x-irma     irmã de uma raiz excluída pela F1.1 → vínculo não resolvido
 *  semchave   sem início → excluída pela F1.1 (jogo-sem-chave)
 */
import type { ArquivoEntrada } from '../../src/index';
import type { EntradaHistorico } from '../../../../apps/web/src/historico';
import { backupGz, backupV1, cenario, comApostaEResultado } from './geradores';
import { buildGravado, comConteudo, evidenciaReproduzivel } from './reproducao';

export const COMMIT_ORIGINAL = 'a'.repeat(40);
export const NOMES_PROIBIDOS = [
  'Flamengo',
  'Atlético',
  'Superbet',
  'Bet365',
  'Pinnacle',
  'jogo-r',
  'h1',
  'semchave',
];

export async function arquivosBancada(): Promise<ArquivoEntrada[]> {
  const base = (await cenario()).entrada;
  const e = (id: string, f: (x: EntradaHistorico) => void = () => undefined): EntradaHistorico => {
    const x = { ...structuredClone(base), id };
    f(x);
    return x;
  };
  const apito = Date.parse(base.resumo.inicio);
  const depois = (min: number) => new Date(apito + min * 60_000).toISOString();

  const r1 = await evidenciaReproduzivel(buildGravado(COMMIT_ORIGINAL));
  const r2base = await comConteudo(r1, (c) => {
    (c.avaliacao as { v4: { decisao: string } }).v4.decisao = 'NO_BET';
  });
  const r2 = { ...r2base, meta: { ...r2base.meta, revisao: 2, gravadoEm: depois(10) } };
  const soPos = { ...r1, meta: { ...r1.meta, idJogo: 'so-pos', gravadoEm: depois(5) } };

  const jogoR = comApostaEResultado(e('jogo-r'), { oddFechamento: 1.8, fechamentoOutros: [2.1] });
  const v3 = [jogoR, e('so-pos')];
  const v1 = [
    e('h1'),
    { ...comApostaEResultado(e('h1-irma'), {}), irmaDe: 'h1' },
    // aposta feita numa irmã cuja raiz não existe: o vínculo não se resolve, sem status inventado
    { ...comApostaEResultado(e('orfa-irma'), {}), irmaDe: 'nao-existe' },
    e('x-irma', (x) => (x.irmaDe = 'semchave')),
    e('semchave', (x) => (x.resumo.inicio = '')),
  ];
  return [
    { nome: 'semana.json.gz', bytes: await backupGz(v3, [r1, r2, soPos]) },
    { nome: 'antigo.json', bytes: backupV1(v1) },
  ];
}
