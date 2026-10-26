import type { TipoMercado } from '@pe/engine';
import { juntarLinhas, parse1win } from '@pe/parsers';
import { importarJson, type OddLine } from '@pe/schemas';
import { useState } from 'react';
import { CartaoOdd } from '../componentes/CartaoOdd';
import { UploadPrints } from '../componentes/UploadPrints';
import { FUSO } from '../estado';
import type { PropsAba } from './tipos';

const ORDEM_MERCADO: TipoMercado[] = ['1X2', 'DC', 'DNB', 'AH', 'total', 'total_time', 'ambas'];

export function AbaOdds({ r, setR, d, casa }: PropsAba & { casa: string }) {
  const [json, setJson] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'alerta'; texto: string } | null>(null);
  const grupo = `odds:${casa}`;
  const nomes = { casa: r.jogo.casa || 'Mandante', fora: r.jogo.fora || 'Visitante' };
  const semTimes = !r.jogo.casa || !r.jogo.fora;
  const daCasa = r.odds.map((l, i) => ({ l, i })).filter(({ l }) => l.casa === casa);
  const naoLidas = (r.prints[grupo] ?? []).flatMap(
    (p) => parse1win(p.texto, { jogo: nomes, data: r.jogo.data, fuso: FUSO, casa }).naoReconhecidas,
  );

  const adicionarLinhas = (novas: OddLine[]) =>
    setR((x) => ({
      ...x,
      odds: juntarLinhas(
        x.odds,
        novas.map((o) => ({ ...o, casa })),
      ).linhas,
    }));
  const mudar = (i: number, m: Partial<OddLine>) =>
    setR((x) => ({ ...x, odds: x.odds.map((l, j) => (j === i ? { ...l, ...m } : l)) }));
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
        dica="Mande todos os mercados, quantos prints forem; repetidos são juntados. O horário de coleta é lido da barra de status."
        leituras={r.prints[grupo] ?? []}
        desabilitado={semTimes}
        onLido={(lido) => {
          setR((x) => ({
            ...x,
            prints: { ...x.prints, [grupo]: [...(x.prints[grupo] ?? []), lido] },
          }));
          adicionarLinhas(
            parse1win(lido.texto, { jogo: nomes, data: r.jogo.data, fuso: FUSO, casa }).linhas,
          );
        }}
        onRemover={(i) =>
          setR((x) => ({
            ...x,
            prints: { ...x.prints, [grupo]: (x.prints[grupo] ?? []).filter((_, j) => j !== i) },
          }))
        }
      />

      {naoLidas.length > 0 && (
        <details className="caixa alerta">
          <summary>{naoLidas.length} linhas com números que o leitor não entendeu</summary>
          <pre>{naoLidas.join('\n')}</pre>
          <p className="miudo">Se alguma for uma odd, adicione à mão abaixo.</p>
        </details>
      )}

      <p>
        <strong>{daCasa.length}</strong> odds da {casa}. Leia o "Ganha se…" de cada uma: se não
        bater com o print, o lado está trocado.
      </p>
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
