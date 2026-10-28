import type { Resultado } from '@pe/parsers';
import { UploadPrints } from '../componentes/UploadPrints';
import { acoesPrints, type PropsAba } from './tipos';

const ROTULO: Record<Resultado, string> = { V: 'vitória', E: 'empate', D: 'derrota' };
const fmt = (x: number) => x.toFixed(2).replace('.', ',');
const placar = (r: Record<Resultado, number>) => `${r.V}V ${r.E}E ${r.D}D`;

export function AbaUltimas({ r, setR, d }: PropsAba) {
  return (
    <section className="passo">
      <h2>Últimas partidas</h2>
      <p className="dica">
        Prints da lista de últimas partidas de cada time (aba &quot;Todos&quot;). O resultado sai do
        placar e o mando da linha (mandante em cima); jogo cortado no fim do print fica de fora.
      </p>
      {(['casa', 'fora'] as const).map((t) => {
        const u = d.ultimas[t];
        return (
          <div key={t}>
            <h3>
              {(t === 'casa' ? r.jogo.casa : r.jogo.fora) ||
                (t === 'casa' ? 'Mandante' : 'Visitante')}
            </h3>
            <UploadPrints
              rotulo={`Últimas partidas do ${t === 'casa' ? 'mandante' : 'visitante'}`}
              leituras={r.prints[`ultimas:${t}`] ?? []}
              {...acoesPrints(setR, `ultimas:${t}`)}
            />
            {u?.avisos.map((a) => (
              <div key={a} className="caixa alerta miudo">
                ⚠️ {a}
              </div>
            ))}
            {u && u.partidas.length > 0 && (
              <div className="caixa ultimas">
                <div className="forma" aria-label="sequência, da mais recente">
                  {u.forma.map((f, i) => (
                    <span key={i} className={`forma-${f}`} title={ROTULO[f]}>
                      {f}
                    </span>
                  ))}
                  <span className="miudo">← mais recente</span>
                </div>
                <p className="miudo">
                  {u.partidas.length} jogos · em casa {placar(u.emCasa)} · fora {placar(u.fora)} ·
                  gols {fmt(u.golsProPorJogo)} pró e {fmt(u.golsContraPorJogo)} contra por jogo
                </p>
                <div className="tabela-rolavel">
                  <table>
                    <tbody>
                      {u.partidas.map((p) => (
                        <tr key={`${p.data}-${p.adversario}`}>
                          <td>{p.data}</td>
                          <td>{p.local === 'casa' ? 'em casa' : 'fora'}</td>
                          <td>{p.adversario}</td>
                          <td>
                            {p.golsPro} × {p.golsContra}
                          </td>
                          <td>
                            <span className={`forma-${p.resultado}`}>{p.resultado}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
