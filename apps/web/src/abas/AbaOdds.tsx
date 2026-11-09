import { chaveSelecao, type LinhaOdd, type TipoMercado } from '@pe/engine';
import {
  checarSanidade,
  conferirPrintOdds,
  juntarLinhas,
  lerOddsCasa,
  lerOddsCasaConsenso,
} from '@pe/parsers';
import { importarJson, type OddLine } from '@pe/schemas';
import { useState } from 'react';
import { CartaoOdd } from '../componentes/CartaoOdd';
import { UploadPrints } from '../componentes/UploadPrints';
import { FUSO, type Leitura, type Rascunho } from '../estado';
import { familiaMercado } from '../camadas';
import { aplicarLeitura, oddsDefasadas } from '../oddsDaCasa';
import type { PropsAba } from './tipos';

const ORDEM_MERCADO: TipoMercado[] = [
  '1X2',
  'DC',
  'DNB',
  'AH',
  'total',
  'total_time',
  'ambas',
  'escanteios_total',
  'escanteios_time',
  'escanteios_ah',
  'escanteios_1x2',
  'cartoes_total',
  'cartoes_time',
  'cartoes_1x2',
];

export function AbaOdds({ r, setR, d, casa }: PropsAba & { casa: string }) {
  const [json, setJson] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'alerta'; texto: string } | null>(null);
  const grupo = `odds:${casa}`;
  const nomes = { casa: r.jogo.casa || 'Mandante', fora: r.jogo.fora || 'Visitante' };
  const semTimes = !r.jogo.casa || !r.jogo.fora;
  const daCasa = r.odds.map((l, i) => ({ l, i })).filter(({ l }) => l.casa === casa);
  // todos os prints da casa lidos juntos: blocos sem título herdam o mercado pela linha repetida
  const lerTodos = (prints: Leitura[]) =>
    lerOddsCasaConsenso(prints, {
      jogo: nomes,
      data: r.jogo.data,
      fuso: FUSO,
      casa,
      horariosPadrao: prints.map((p) => p.capturadoEm),
    });
  const leitura = lerTodos(r.prints[grupo] ?? []);
  const defasadas = oddsDefasadas(r.odds, casa, leitura.linhas);
  /** Grava os prints e refaz as odds da casa a partir deles (lê do estado mais novo). */
  const comPrints = (x: Rascunho, prints: Leitura[]): Rascunho => ({
    ...x,
    prints: { ...x.prints, [grupo]: prints },
    odds: aplicarLeitura(
      x.odds,
      casa,
      lerOddsCasaConsenso(prints, {
        jogo: { casa: x.jogo.casa || 'Mandante', fora: x.jogo.fora || 'Visitante' },
        data: x.jogo.data,
        fuso: FUSO,
        casa,
        horariosPadrao: prints.map((p) => p.capturadoEm),
      }).linhas,
    ),
  });
  const lerUm = (texto: string) =>
    lerOddsCasa([texto], { jogo: nomes, data: r.jogo.data, fuso: FUSO, casa }).linhas;
  const descrever = (texto: string) => {
    const conta = new Map<string, number>();
    for (const l of lerUm(texto))
      conta.set(familiaMercado(l.mercado), (conta.get(familiaMercado(l.mercado)) ?? 0) + 1);
    return conta.size
      ? [...conta].map(([f, n]) => `${f} ${n}`).join(' · ')
      : 'Sem odds com modelo neste print';
  };
  const conferir = (texto: string) =>
    conferirPrintOdds(texto, {
      jogo: nomes,
      data: r.jogo.data,
      hora: r.jogo.hora,
      oddsLidas: lerUm(texto).length,
    });

  /**
   * Acrescenta só odds novas: não sobrescreve as já existentes (nem as que você corrigiu),
   * salvo as marcadas com erro: uma leitura nova (ou o leitor corrigido) toma o lugar delas.
   */
  const adicionarLinhas = (novas: OddLine[]) =>
    setR((x) => {
      const chave = (o: OddLine) => `${o.casa.toLowerCase()}#${chaveSelecao(o as LinhaOdd)}`;
      const lidas = juntarLinhas(novas.map((o) => ({ ...o, casa }))).linhas;
      const comErro = new Set(
        checarSanidade(x.odds as LinhaOdd[])
          .filter((p) => p.nivel === 'erro')
          .map((p) => p.indice),
      );
      const novasChaves = new Set(lidas.map(chave));
      const mantidas = x.odds.filter((o, i) => !(comErro.has(i) && novasChaves.has(chave(o))));
      const existentes = new Set(mantidas.map(chave));
      const extras = lidas.filter((o) => !existentes.has(chave(o)));
      return { ...x, odds: [...mantidas, ...extras] };
    });
  const mudar = (i: number, m: Partial<OddLine>) =>
    // corrigida à mão: a releitura dos prints não mexe mais nela
    setR((x) => ({
      ...x,
      odds: x.odds.map((l, j) => (j === i ? { ...l, ...m, fonte: 'manual' } : l)),
    }));
  const remover = (i: number) => setR((x) => ({ ...x, odds: x.odds.filter((_, j) => j !== i) }));

  function importar() {
    const res = importarJson(json);
    if (!res.ok || !res.dados) return setMsg({ tipo: 'alerta', texto: res.erros.join(' · ') });
    adicionarLinhas(res.dados.odds);
    setMsg({ tipo: 'ok', texto: `${res.dados.odds.length} odds importadas.` });
    setJson('');
  }

  function removerCasa() {
    if (!confirm(`Remover a casa ${casa} e todas as odds dela?`)) return;
    setR((x) => ({
      ...x,
      casas: x.casas.filter((c) => c !== casa),
      odds: x.odds.filter((l) => l.casa !== casa),
      prints: Object.fromEntries(Object.entries(x.prints).filter(([k]) => k !== grupo)),
    }));
  }

  const ordenadas = [...daCasa].sort(
    (a, b) =>
      ((ORDEM_MERCADO.indexOf(a.l.mercado) + 99) % 99) -
        ((ORDEM_MERCADO.indexOf(b.l.mercado) + 99) % 99) ||
      a.l.periodo.localeCompare(b.l.periodo) ||
      (a.l.time ?? '').localeCompare(b.l.time ?? '') ||
      (a.l.linha ?? 0) - (b.l.linha ?? 0),
  );

  return (
    <section className="passo">
      <div className="titulo-linha">
        <h2>Odds · {casa}</h2>
        <button className="perigo mini" onClick={removerCasa}>
          remover casa
        </button>
      </div>
      {semTimes && (
        <div className="caixa alerta">
          Preencha os times na aba Jogo antes: o leitor usa os nomes para saber o lado de cada odd.
        </div>
      )}
      <UploadPrints
        rotulo={`Enviar prints da ${casa} (todos os mercados)`}
        dica="Mande todos os mercados, quantos prints forem; repetidos são juntados. O horário de coleta é lido da barra de status. Apagar um print tira as odds dele."
        leituras={r.prints[grupo] ?? []}
        desabilitado={semTimes}
        releituras={[170]}
        descrever={descrever}
        conferir={conferir}
        onLido={(lido) => setR((x) => comPrints(x, [...(x.prints[grupo] ?? []), lido]))}
        onRemover={(i) =>
          setR((x) =>
            comPrints(
              x,
              (x.prints[grupo] ?? []).filter((_, j) => j !== i),
            ),
          )
        }
      />

      {defasadas > 0 && (
        <div className="caixa alerta">
          <strong>{defasadas} odd(s) não saem mais dos prints desta casa</strong>: vieram de um
          print já apagado ou de uma versão antiga do leitor, e continuam entrando na análise.{' '}
          <button
            className="primario mini"
            onClick={() => setR((x) => comPrints(x, x.prints[grupo] ?? []))}
          >
            Reler os prints
          </button>
          <p className="miudo">O que você corrigiu à mão não muda.</p>
        </div>
      )}
      {defasadas === 0 && (r.prints[grupo] ?? []).length > 0 && (
        <p className="miudo">
          O leitor melhorou ou faltou alguma odd?{' '}
          <button
            className="discreto mini"
            onClick={() => setR((x) => comPrints(x, x.prints[grupo] ?? []))}
          >
            Reler os prints
          </button>{' '}
          sem colar de novo. O que você corrigiu à mão não muda.
        </p>
      )}
      {leitura.avisos
        .filter((a) => !a.startsWith('horário'))
        // com odds de outros prints, "nenhuma odd" é só um print sem mercado com modelo: a lista
        // de prints já mostra qual
        .filter((a) => !(a.startsWith('nenhuma odd') && leitura.linhas.length))
        .map((a) => (
          <div key={a} className="caixa alerta">
            {a}
          </div>
        ))}
      {leitura.ignoradas > 0 && (
        <p className="dica">
          {leitura.ignoradas} linhas de mercados sem modelo (primeiro cartão, vitória antecipada,
          vencer de virada…) foram ignoradas de propósito.
        </p>
      )}
      {leitura.naoReconhecidas.length > 0 && (
        <details className="caixa alerta">
          <summary>
            {leitura.naoReconhecidas.length} linhas com números que o leitor não entendeu
          </summary>
          <pre>{leitura.naoReconhecidas.join('\n')}</pre>
          <p className="miudo">Se alguma for uma odd, adicione à mão abaixo.</p>
        </details>
      )}

      <p>
        <strong>{daCasa.length}</strong> odds da {casa}. Leia o "Ganha se…" de cada uma: se não
        bater com o print, o lado está trocado.
      </p>
      <div className="cc-odds-grade">
        {ordenadas.map(({ l, i }) => (
          <CartaoOdd
            key={`${i}-${JSON.stringify(l)}`}
            linha={l}
            nomes={nomes}
            data={r.jogo.data}
            problemas={d.problemasOdds.filter((p) => p.indice === i)}
            onMudar={(m) => mudar(i, m)}
            onRemover={() => remover(i)}
          />
        ))}
      </div>
      <button
        onClick={() =>
          setR((x) => ({
            ...x,
            odds: [
              ...x.odds,
              { casa, mercado: '1X2', lado: '1', odd: 2, periodo: 'FT', fonte: 'manual' },
            ],
          }))
        }
      >
        + Adicionar odd à mão
      </button>

      <details>
        <summary>Importar JSON</summary>
        <p className="dica">
          Alternativa quando o OCR falha: cole um JSON com {'{ "odds": [ ... ] }'} (formato no
          README).
        </p>
        <textarea rows={5} value={json} onChange={(e) => setJson(e.target.value)} />
        <button onClick={importar} disabled={!json.trim()}>
          Importar
        </button>
        {msg && <div className={`caixa ${msg.tipo}`}>{msg.texto}</div>}
      </details>
    </section>
  );
}
