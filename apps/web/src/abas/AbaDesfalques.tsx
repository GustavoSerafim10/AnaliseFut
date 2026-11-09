import { UploadPrints } from '../componentes/UploadPrints';
import { acoesPrints, type PropsAba } from './tipos';

export function AbaDesfalques({ r, setR, d }: PropsAba) {
  const semTimes = !r.jogo.casa || !r.jogo.fora;
  const nome = (t: 'casa' | 'fora') => (t === 'casa' ? r.jogo.casa : r.jogo.fora);
  return (
    <section className="passo">
      <h2>Desfalques</h2>
      <UploadPrints
        rotulo="Enviar print dos desfalques"
        dica='SofaScore → "Contusões e suspensões" (esquerda = mandante, direita = visitante) ou SuperScore → "Jogadores ausentes". Não precisa do nome nem do escudo dos times.'
        leituras={r.prints.desfalques ?? []}
        desabilitado={semTimes}
        modo="lados"
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
