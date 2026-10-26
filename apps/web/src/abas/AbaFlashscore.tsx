import type { CategoriaTrecho } from '@pe/parsers';
import type { PropsAba } from './tipos';

const CATEGORIAS: [CategoriaTrecho, string][] = [
  ['desfalques', 'Desfalques'],
  ['casa_fora', 'Casa / fora'],
  ['h2h', 'Confronto direto'],
  ['forma', 'Forma e notícias'],
  ['destaque', 'Estatísticas de destaque'],
  ['geral', 'Geral'],
];

export function AbaFlashscore({ r, setR, d }: PropsAba) {
  const nome = (t?: 'casa' | 'fora') =>
    t ? (t === 'casa' ? r.jogo.casa : r.jogo.fora) : 'os dois / geral';
  return (
    <section className="passo">
      <h2>Flashscore</h2>
      <p className="dica">
        Cole aqui o texto de análise do jogo (prévia). O site separa por assunto e por time.
      </p>
      <textarea
        rows={8}
        value={r.flashscore}
        onChange={(e) => setR((x) => ({ ...x, flashscore: e.target.value }))}
        placeholder="Cole o texto do Flashscore…"
      />
      {d.flash && (
        <>
          {d.flash.campanhas.length > 0 && (
            <div className="caixa ok">
              <strong>Campanha casa/fora encontrada</strong>
              <ul>
                {d.flash.campanhas.map((c, i) => (
                  <li key={i}>
                    {nome(c.time)} {c.local === 'casa' ? 'em casa' : 'fora'}: {c.jogos ?? '?'}{' '}
                    jogos, {c.pontos ?? '?'} pts
                    {c.vitorias !== undefined && ` (${c.vitorias}V ${c.empates}E ${c.derrotas}D)`}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {CATEGORIAS.map(([cat, titulo]) => {
            const ts = d.flash!.trechos.filter((t) => t.categoria === cat);
            if (!ts.length) return null;
            return (
              <details key={cat} open={cat === 'desfalques' || cat === 'casa_fora'}>
                <summary>
                  {titulo} ({ts.length})
                </summary>
                <ul className="miudo">
                  {ts.map((t, i) => (
                    <li key={i}>
                      <strong>{nome(t.time)}:</strong> {t.texto}
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </>
      )}
    </section>
  );
}
