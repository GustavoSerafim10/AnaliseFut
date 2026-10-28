import { CAMPOS_STATS, type FonteStats } from '@pe/parsers';
import { RaioX } from '../componentes/RaioX';
import { UploadPrints } from '../componentes/UploadPrints';
import { acoesPrints, type PropsAba } from './tipos';

const INFO: Record<FonteStats, { titulo: string; dica: string }> = {
  sofascore: {
    titulo: 'SofaScore',
    dica: 'Página "Comparar equipes" (os dois times, temporada atual). Pode mandar vários prints rolando a página: as partes repetidas são juntadas.',
  },
  superscore: {
    titulo: 'SuperScore',
    dica: 'Aba Estatísticas → "Estatísticas do time" com "Média" selecionado. Vários prints rolando a página.',
  },
};

export function AbaStats({ r, setR, d, fonte }: PropsAba & { fonte: FonteStats }) {
  const leitura = fonte === 'sofascore' ? d.sofa : d.sup;
  const info = INFO[fonte];
  const semTimes = !r.jogo.casa || !r.jogo.fora;
  const fmt = (x?: number) => (x === undefined ? '—' : String(x).replace('.', ','));

  return (
    <section className="passo">
      <h2>{info.titulo}</h2>
      {semTimes && (
        <div className="caixa alerta">
          Preencha os times na aba Jogo antes: o leitor usa os nomes para saber a ordem das colunas.
        </div>
      )}
      <UploadPrints
        rotulo={`Enviar prints do ${info.titulo}`}
        dica={info.dica}
        leituras={r.prints[fonte] ?? []}
        desabilitado={semTimes}
        {...acoesPrints(setR, fonte)}
      />

      <RaioX d={d} nomes={{ casa: r.jogo.casa || 'Mandante', fora: r.jogo.fora || 'Visitante' }} />

      {leitura && (
        <>
          {leitura.avisos.map((a) => (
            <div key={a} className="caixa alerta miudo">
              ⚠️ {a}
            </div>
          ))}
          <div className="tabela-rolavel">
            <table>
              <thead>
                <tr>
                  <th>Dado</th>
                  <th>{r.jogo.casa}</th>
                  <th>{r.jogo.fora}</th>
                </tr>
              </thead>
              <tbody>
                {CAMPOS_STATS.filter((c) => leitura.campos[c.campo]).map((c) => {
                  const v = leitura.campos[c.campo]!;
                  return (
                    <tr key={c.campo} className={v.avisos.length ? 'linha-alerta' : ''}>
                      <td>
                        {c.rotulo}
                        {v.avisos.map((a) => (
                          <div key={a} className="miudo alerta-txt">
                            {a}
                          </div>
                        ))}
                      </td>
                      <td>{fmt(v.casa)}</td>
                      <td>{fmt(v.fora)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {leitura.outros.length > 0 && (
            <details>
              <summary>Outros dados lidos ({leitura.outros.length})</summary>
              <ul className="miudo">
                {leitura.outros.map((o) => (
                  <li key={o.rotulo}>
                    {o.rotulo}: {fmt(o.casa)} × {fmt(o.fora)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="dica">
            Valores errados ou vazios se corrigem na aba Análise, na tabela "Dados consolidados".
          </p>
        </>
      )}
    </section>
  );
}
