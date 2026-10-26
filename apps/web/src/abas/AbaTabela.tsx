import { UploadPrints } from '../componentes/UploadPrints';
import { acoesPrints, type PropsAba } from './tipos';

export function AbaTabela({ r, setR, d }: PropsAba) {
  const semTimes = !r.jogo.casa || !r.jogo.fora;
  const nome = (t: 'casa' | 'fora') => (t === 'casa' ? r.jogo.casa : r.jogo.fora);
  return (
    <section className="passo">
      <h2>Classificação e desfalques</h2>

      <h3>Classificação</h3>
      <UploadPrints
        rotulo="Enviar print da classificação"
        dica="Recorte só a tabela (sem as colunas laterais da página): a leitura fica muito melhor."
        leituras={r.prints.classificacao ?? []}
        desabilitado={semTimes}
        {...acoesPrints(setR, 'classificacao')}
      />
      {d.avisosClassificacao.map((a) => (
        <div key={a} className="caixa alerta miudo">
          ⚠️ {a}
        </div>
      ))}
      {d.classificacao.length > 0 && (
        <div className="tabela-rolavel">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Time</th>
                <th>Pts</th>
              </tr>
            </thead>
            <tbody>
              {d.classificacao.map((l) => (
                <tr key={`${l.posicao}-${l.time}`} className={l.doJogo ? 'linha-destaque' : ''}>
                  <td>{l.posicao}</td>
                  <td>{l.time}</td>
                  <td>{l.pontos ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="dica">
            Os pontos podem sair errados no OCR (selos coloridos): confira os dos times do jogo.
          </p>
        </div>
      )}

      <h3>Desfalques</h3>
      <UploadPrints
        rotulo="Enviar print dos desfalques"
        dica='SuperScore → "Jogadores ausentes". Recorte só o bloco da lista.'
        leituras={r.prints.desfalques ?? []}
        desabilitado={semTimes}
        {...acoesPrints(setR, 'desfalques')}
      />
      {d.avisosDesfalques.map((a) => (
        <div key={a} className="caixa alerta miudo">
          ⚠️ {a}
        </div>
      ))}
      {(['casa', 'fora'] as const).map((t) => {
        const ds = d.desfalques.filter((x) => x.time === t);
        return ds.length ? (
          <div key={t} className="caixa">
            <strong>{nome(t)}</strong>: {ds.map((x) => x.jogador).join(', ')}
          </div>
        ) : null;
      })}
      <p className="dica">
        O impacto dos desfalques no λ é escolhido por você na aba Análise (nenhum, baixo, médio,
        alto, crítico).
      </p>
    </section>
  );
}
