import { CAMPOS_STATS, type FonteStats } from '@pe/parsers';
import { RaioX } from '../componentes/RaioX';
import { conferirPrintEstatisticas } from '@pe/parsers';
import { UploadPrints } from '../componentes/UploadPrints';
import { acoesPrints, type PropsAba } from './tipos';
import { descreverContexto } from '../contextoDaAmostra';

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

/**
 * Competição e temporada lidas do cabeçalho dos prints (só exibição: não entra no λ nem na DQ).
 * Alerta quando a amostra mistura competições/temporadas ou não bate com o jogo.
 */
export function AmostraLida({ d }: { d: PropsAba['d'] }) {
  const c = d.contextoAmostra;
  const desc = descreverContexto(c);
  if (!desc && !c.leituras.length) return null;
  return (
    <div className={`caixa miudo amostra-lida${c.item3d === 'SIM' ? ' alerta' : ''}`}>
      <strong>Amostra:</strong> {desc ?? 'cabeçalho do print ilegível'}
      {c.leituras.some((l) => l.confianca === 'reconstruida') && ' (temporada reconstruída do OCR)'}
      {c.item3d === 'SIM' && <> · ⚠️ {c.motivos.join('; ')}</>}
      {c.item3d === 'DADO INDISPONÍVEL' && c.motivos.length > 0 && <> · {c.motivos.join('; ')}</>}
    </div>
  );
}

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
        conferir={conferirPrintEstatisticas}
        releituras={[130, 90]}
        {...acoesPrints(setR, fonte)}
      />
      <AmostraLida d={d} />

      <RaioX
        d={d}
        nomes={{ casa: r.jogo.casa || 'Mandante', fora: r.jogo.fora || 'Visitante' }}
        correcoes={Object.keys(r.correcoes).length}
        fonte={fonte}
      />

      {leitura && (
        <>
          {leitura.avisos.map((a) => (
            <div key={a} className="caixa alerta miudo">
              ⚠️ {a}
            </div>
          ))}
          <h3>O que o {info.titulo} leu (só este site)</h3>
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
