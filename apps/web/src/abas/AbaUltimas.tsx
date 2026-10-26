import { UploadPrints } from '../componentes/UploadPrints';
import { acoesPrints, type PropsAba } from './tipos';

export function AbaUltimas({ r, setR }: PropsAba) {
  return (
    <section className="passo">
      <h2>Últimas partidas</h2>
      <p className="dica">
        Prints das últimas partidas de cada time, para ver o desempenho em casa e fora. Por enquanto
        o site guarda e mostra o texto lido; o leitor automático (placares, mando, sequência) entra
        assim que você mandar um print de exemplo para calibrar.
      </p>
      <UploadPrints
        rotulo="Enviar prints das últimas partidas"
        leituras={r.prints.ultimas ?? []}
        {...acoesPrints(setR, 'ultimas')}
      />
    </section>
  );
}
