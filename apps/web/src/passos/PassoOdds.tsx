import { juntarLinhas, lerPrint, type LeituraPrint } from '@pe/parsers';
import { importarJson } from '@pe/schemas';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { FUSO, pct, type Rascunho } from '../estado';
import { lerImagem } from '../ocr';

interface Leitura extends LeituraPrint {
  arquivo: string;
  texto: string;
}

interface Props {
  r: Rascunho;
  setR: Dispatch<SetStateAction<Rascunho>>;
}

export function PassoOdds({ r, setR }: Props) {
  const [leituras, setLeituras] = useState<Leitura[]>([]);
  const [progresso, setProgresso] = useState<{ arquivo: string; p: number } | null>(null);
  const [json, setJson] = useState('');
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'alerta'; texto: string } | null>(null);
  const semTimes = !r.jogo.casa || !r.jogo.fora;

  async function aoEscolher(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    const ctx = { jogo: { casa: r.jogo.casa, fora: r.jogo.fora }, data: r.jogo.data, fuso: FUSO };
    for (const arq of Array.from(arquivos)) {
      setProgresso({ arquivo: arq.name, p: 0 });
      try {
        const texto = await lerImagem(arq, (p) => setProgresso({ arquivo: arq.name, p }));
        const leitura = { ...lerPrint(texto, ctx), arquivo: arq.name, texto };
        setLeituras((ls) => [...ls, leitura]);
        if (leitura.linhas.length) {
          setR((x) => {
            const j = juntarLinhas(x.linhas, leitura.linhas);
            return { ...x, linhas: j.linhas, conferido: false };
          });
        }
      } catch (e) {
        setMensagem({
          tipo: 'alerta',
          texto: `Falha no OCR de ${arq.name}: ${(e as Error).message}`,
        });
      }
    }
    setProgresso(null);
  }

  function aoImportar() {
    const res = importarJson(json);
    if (!res.ok || !res.dados) {
      setMensagem({ tipo: 'alerta', texto: res.erros.join(' · ') });
      return;
    }
    const d = res.dados;
    setR((x) => ({
      ...x,
      jogo: {
        ...x.jogo,
        casa: x.jogo.casa || d.jogo?.casa || '',
        fora: x.jogo.fora || d.jogo?.fora || '',
      },
      linhas: juntarLinhas(x.linhas, d.odds).linhas,
      conferido: false,
    }));
    setMensagem({
      tipo: 'ok',
      texto: `${d.odds.length} odds importadas. Confira tudo no passo 3.`,
    });
    setJson('');
  }

  return (
    <section className="passo">
      <h2>2. Prints e odds</h2>
      {semTimes && (
        <div className="caixa alerta">
          Preencha mandante e visitante no passo 1: o leitor usa os nomes para saber o lado de cada
          odd.
        </div>
      )}

      <label className="upload">
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={semTimes || !!progresso}
          onChange={(e) => aoEscolher(e.target.files)}
        />
        <span>📷 Escolher prints (1win)</span>
      </label>
      <p className="dica">
        A leitura é feita no próprio aparelho (Tesseract.js). Na primeira vez baixa os dados de
        idioma. O horário de coleta é lido da barra de status do print.
      </p>

      {progresso && (
        <div className="caixa">
          Lendo {progresso.arquivo}… {pct(progresso.p, 0)}
          <progress value={progresso.p} max={1} />
        </div>
      )}

      {leituras.map((l, i) => (
        <details key={i} className={`caixa ${l.reconhecido && l.linhas.length ? 'ok' : 'alerta'}`}>
          <summary>
            {l.arquivo}: {l.fonte} · {l.linhas.length} odds
            {l.naoReconhecidas.length ? ` · ${l.naoReconhecidas.length} linhas não lidas` : ''}
          </summary>
          {l.avisos.map((a) => (
            <p key={a}>⚠️ {a}</p>
          ))}
          {l.naoReconhecidas.length > 0 && (
            <>
              <p>Linhas com números que não entendi (confira se faltou alguma odd):</p>
              <pre>{l.naoReconhecidas.join('\n')}</pre>
            </>
          )}
          <p>Texto lido pelo OCR:</p>
          <pre>{l.texto}</pre>
        </details>
      ))}

      <h3>Importar JSON</h3>
      <p className="dica">
        Alternativa quando o OCR falha: gere no chat do Claude um JSON com{' '}
        <code>
          {
            '{ "odds": [ { "casa", "mercado", "linha", "lado", "odd", "horarioColeta", "periodo", "time" } ] }'
          }
        </code>
        .
      </p>
      <textarea
        rows={5}
        value={json}
        onChange={(e) => setJson(e.target.value)}
        placeholder='{"odds":[{"casa":"1win","mercado":"1X2","lado":"1","odd":1.24}]}'
      />
      <button onClick={aoImportar} disabled={!json.trim()}>
        Importar
      </button>
      {mensagem && <div className={`caixa ${mensagem.tipo}`}>{mensagem.texto}</div>}

      <p>
        <strong>{r.linhas.length}</strong> odds na análise.
      </p>
    </section>
  );
}
