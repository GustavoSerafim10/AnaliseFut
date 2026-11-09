/**
 * Painel do Histórico: cartões de Entradas/Green/Red/Winrate/ROI/Unidades/EV/Odd e o placar
 * de acerto. Tudo vem de painel() em historico.ts (1 unidade por entrada).
 */
import type { ReactNode } from 'react';
import { JOGOS_PARA_CONFIAR, type Painel, type PlacarAcerto } from '../historico';
import { Icone, type NomeIcone } from './ui';

const n2 = (x: number) => x.toFixed(2).replace('.', ',');
const p1 = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
const sinal = (x: number, f: (v: number) => string) =>
  `${x > 0 ? '+' : x < 0 ? '−' : ''}${f(Math.abs(x))}`;

function Cartao({
  icone,
  titulo,
  valor,
  tom,
  children,
}: {
  icone: NomeIcone;
  titulo: string;
  valor: ReactNode;
  tom?: 'ok' | 'erro' | 'amarelo';
  children?: ReactNode;
}) {
  return (
    <div className={`kpi ${tom ? `kpi-${tom}` : ''}`}>
      <div className="kpi-topo">
        <span className="kpi-icone">
          <Icone nome={icone} />
        </span>
        <span className="kpi-titulo">{titulo}</span>
      </div>
      <div className="kpi-valor">{valor}</div>
      {children && <div className="kpi-detalhe">{children}</div>}
    </div>
  );
}

const tomDe = (x: number | null) => (x === null || x === 0 ? undefined : x > 0 ? 'ok' : 'erro');

export function CartoesPainel({ p, rotulo = 'Entradas' }: { p: Painel; rotulo?: string }) {
  const vazio = <span className="kpi-vazio">—</span>;
  return (
    <div className="faixa-kpi">
      <Cartao icone="bola" titulo={rotulo} valor={p.entradas}>
        <span>
          apuradas <b>{p.entradas - p.pendentes}</b>
        </span>
        <span>
          pendentes <b>{p.pendentes}</b>
        </span>
      </Cartao>
      <Cartao icone="trofeu" titulo="Green" valor={p.green} tom={p.green ? 'ok' : undefined} />
      <Cartao icone="proibido" titulo="Red" valor={p.red} tom={p.red ? 'erro' : undefined} />
      <Cartao icone="relogio" titulo="Devolvidas" valor={p.devolvidas} />
      <Cartao icone="alvo" titulo="Winrate" valor={p.winrate === null ? vazio : p1(p.winrate)}>
        <span>green ÷ (green + red)</span>
      </Cartao>
      <Cartao
        icone="modelo"
        titulo="Unidades"
        valor={p.green + p.red + p.devolvidas ? sinal(p.unidades, n2) : vazio}
        tom={tomDe(p.unidades)}
      >
        <span>1 un. por entrada</span>
      </Cartao>
      <Cartao
        icone="cerebro"
        titulo="ROI"
        valor={p.roi === null ? vazio : sinal(p.roi, p1)}
        tom={tomDe(p.roi)}
      />
      <Cartao
        icone="lupa"
        titulo="EV médio"
        valor={p.evMedio === null ? vazio : sinal(p.evMedio, p1)}
      >
        <span>na hora da análise</span>
      </Cartao>
      <Cartao
        icone="info"
        titulo="Odd média"
        valor={p.oddMedia === null ? vazio : n2(p.oddMedia)}
      />
    </div>
  );
}

/** O teste real da lista "Melhores entradas": a chance prometida × o que aconteceu, por faixa. */
export function PlacarDeAcerto({ p }: { p: PlacarAcerto }) {
  const faltam = Math.max(0, JOGOS_PARA_CONFIAR - p.apuradas);
  const linhas = [...p.faixas.filter((f) => f.apuradas), ...(p.apuradas ? [p.total] : [])];
  return (
    <div className="caixa placar-acerto">
      <h3>Placar de acerto das Melhores entradas</h3>
      <p className="miudo">
        Conta a 1ª entrada de cada jogo, valendo 1 unidade, tendo você apostado ou não.
        {p.pendentes > 0 && ` ${p.pendentes} aguardando o placar.`}
      </p>
      {linhas.length === 0 ? (
        <p className="miudo">
          Ainda sem jogo apurado. Registre os placares das análises com entrada para o placar
          começar.
        </p>
      ) : (
        <div className="tabela-rolavel">
          <table>
            <thead>
              <tr>
                <th>Chance estimada</th>
                <th>Jogos</th>
                <th>Green / Red</th>
                <th>Acertou</th>
                <th>Prometeu</th>
                <th>Odd pedia</th>
                <th>Unidades</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((f) => (
                <tr key={f.nome} className={f === p.total ? 'linha-total' : undefined}>
                  <td>{f.nome}</td>
                  <td>{f.apuradas}</td>
                  <td>
                    {f.green} / {f.red}
                    {f.devolvidas > 0 && ` (${f.devolvidas} dev.)`}
                  </td>
                  <td>{f.acerto === null ? '—' : p1(f.acerto)}</td>
                  <td>{f.chanceMedia === null ? '—' : p1(f.chanceMedia)}</td>
                  <td>{f.minimoMedio === null ? '—' : p1(f.minimoMedio)}</td>
                  <td className={f.unidades >= 0 ? 'positivo' : 'negativo'}>
                    {sinal(f.unidades, n2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={faltam ? 'dica' : 'miudo'}>
        {faltam
          ? `Ainda cedo para confiar: ${p.apuradas} de ${JOGOS_PARA_CONFIAR} jogos apurados. Até lá, o resultado pode ser só sorte. Use valores pequenos.`
          : 'O método se paga se "Acertou" ficar acima de "Odd pedia" e as unidades forem positivas.'}
      </p>
    </div>
  );
}
