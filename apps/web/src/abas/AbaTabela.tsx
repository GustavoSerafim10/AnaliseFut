import type { CampoClassificacao, LinhaClassificacao } from '@pe/parsers';
import { Fragment, type ReactNode } from 'react';
import { UploadPrints } from '../componentes/UploadPrints';
import { acoesPrints, type PropsAba } from './tipos';

const ROTULO_STATUS = { provavel: 'provável', confirmada: 'confirmada' } as const;
const ROTULO_FORMA = { V: 'vitória', E: 'empate', D: 'derrota' } as const;
const comSinal = (n: number) => (n > 0 ? `+${n}` : String(n));

/** colunas da classificação; só aparecem as que o print trouxe */
const COLUNAS: {
  campo: CampoClassificacao | 'forma';
  rotulo: string;
  titulo: string;
  valor: (l: LinhaClassificacao) => ReactNode;
}[] = [
  { campo: 'jogos', rotulo: 'J', titulo: 'jogos', valor: (l) => l.jogos },
  { campo: 'vitorias', rotulo: 'V', titulo: 'vitórias', valor: (l) => l.vitorias },
  { campo: 'empates', rotulo: 'E', titulo: 'empates', valor: (l) => l.empates },
  { campo: 'derrotas', rotulo: 'D', titulo: 'derrotas', valor: (l) => l.derrotas },
  {
    campo: 'saldo',
    rotulo: 'SG',
    titulo: 'saldo de gols',
    valor: (l) => (l.saldo === undefined ? undefined : comSinal(l.saldo)),
  },
  {
    campo: 'gols',
    rotulo: 'Gols',
    titulo: 'gols pró : gols contra',
    valor: (l) => (l.golsPro === undefined ? undefined : `${l.golsPro}:${l.golsContra}`),
  },
  {
    campo: 'forma',
    rotulo: 'Últimos 5',
    titulo: 'últimos jogos, na ordem do print',
    valor: (l) =>
      l.forma && (
        <span className="forma-mini">
          {l.forma.map((f, i) => (
            <span key={i} className={`forma-${f}`} title={ROTULO_FORMA[f]}>
              {f}
            </span>
          ))}
        </span>
      ),
  },
  { campo: 'pontos', rotulo: 'Pts', titulo: 'pontos', valor: (l) => l.pontos },
];

function celula(l: LinhaClassificacao, campo: CampoClassificacao | 'forma') {
  if (campo === 'forma') return {};
  if (l.conferir.includes(campo))
    return { className: 'celula-conferir', title: 'não fecha com as contas: conferir no print' };
  if (l.calculados.includes(campo))
    return {
      className: 'celula-calculada',
      title: 'ilegível no print: saiu da conta (J = V + E + D, Pts = 3V + E, SG = GP − GC)',
    };
  return {};
}

export function AbaTabela({ r, setR, d }: PropsAba) {
  const semTimes = !r.jogo.casa || !r.jogo.fora;
  const nome = (t: 'casa' | 'fora') => (t === 'casa' ? r.jogo.casa : r.jogo.fora);
  const esc = d.escalacao;
  const colunas = COLUNAS.filter((c) => d.classificacao.some((l) => c.valor(l) !== undefined));
  return (
    <section className="passo">
      <h2>Classificação, desfalques e escalações</h2>

      <h3>Classificação</h3>
      <UploadPrints
        rotulo="Enviar print da classificação"
        dica="Recorte a tabela com a linha dos títulos (P, V, E, D, Pts…) e sem as colunas laterais da página: o site relê cada coluna só com números e pega pela cor os últimos jogos e as zonas."
        leituras={r.prints.classificacao ?? []}
        desabilitado={semTimes}
        modo="tabela"
        {...acoesPrints(setR, 'classificacao')}
      />
      {d.avisosClassificacao.map((a) => (
        <div key={a} className="caixa alerta miudo">
          ⚠️ {a}
        </div>
      ))}
      {d.classificacao.length > 0 && (
        <div className="tabela-rolavel">
          <table className="classificacao">
            <thead>
              <tr>
                <th>#</th>
                <th>Time</th>
                {colunas.map((c) => (
                  <th key={c.campo} title={c.titulo}>
                    {c.rotulo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.classificacao.map((l, i) => {
                const ant = d.classificacao[i - 1]?.zona;
                const novaZona =
                  l.zona?.nome && (ant?.nome !== l.zona.nome || ant.cor !== l.zona.cor);
                return (
                  <Fragment key={`${l.posicao}-${l.time}`}>
                    {novaZona && l.zona && (
                      <tr className="zona-titulo">
                        <td colSpan={colunas.length + 2}>
                          <span className="zona-cor" style={{ background: l.zona.cor }} />
                          {l.zona.nome}
                        </td>
                      </tr>
                    )}
                    <tr className={l.doJogo ? 'linha-destaque' : undefined}>
                      <td
                        className="zona-pos"
                        style={l.zona ? { boxShadow: `inset 3px 0 0 ${l.zona.cor}` } : undefined}
                      >
                        {l.posicao}
                      </td>
                      <td>{l.time}</td>
                      {colunas.map((c) => (
                        <td key={c.campo} {...celula(l, c.campo)}>
                          {c.valor(l) ?? '—'}
                        </td>
                      ))}
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <p className="dica">
            {d.classificacao.some((l) => l.calculados.length) &&
              'Em itálico: ilegível no print, saiu da conta (J = V + E + D, Pts = 3V + E, SG = GP − GC). '}
            {d.classificacao.some((l) => l.conferir.length) &&
              'Em amarelo: não fecha com as contas, confira no print. '}
            Confira sempre os dois times do jogo.
          </p>
        </div>
      )}

      <h3>Desfalques</h3>
      <UploadPrints
        rotulo="Enviar print dos desfalques"
        dica='SuperScore → "Jogadores ausentes". Pode ser a tela inteira: o que vem antes do título é ignorado.'
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

      <h3>Escalações</h3>
      <UploadPrints
        rotulo="Enviar prints da escalação"
        dica='Flashscore, SuperScore ou SofaScore → "Escalações": print do campo com os dois times (pode ser a tela inteira). Campo deitado: esquerda = mandante; em pé: em cima = mandante.'
        leituras={r.prints.escalacao ?? []}
        desabilitado={semTimes}
        modo="lados"
        {...acoesPrints(setR, 'escalacao')}
      />
      <div className="abas-mini">
        {(
          [
            [
              'auto',
              `Automático${esc.status && r.statusEscalacao === 'auto' ? ` (${ROTULO_STATUS[esc.status]})` : ''}`,
            ],
            ['provavel', 'Provável'],
            ['confirmada', 'Confirmada'],
          ] as const
        ).map(([s, rot]) => (
          <button
            key={s}
            className={r.statusEscalacao === s ? 'ativo' : ''}
            onClick={() => setR((x) => ({ ...x, statusEscalacao: s }))}
          >
            {rot}
          </button>
        ))}
      </div>
      {esc.avisos.map((a) => (
        <div key={a} className="caixa alerta miudo">
          ⚠️ {a}
        </div>
      ))}
      <div className="grade2">
        {(['casa', 'fora'] as const).map((t) => {
          const e = esc[t];
          const manual = r.escalacaoManual[t];
          return (
            <div key={t} className="caixa escalacao">
              <div className="escalacao-topo">
                <strong>{nome(t)}</strong>
                <span className="miudo">
                  {t === 'casa' ? 'mandante' : 'visitante'}
                  {e.formacao && ` · ${e.formacao}`} · {e.titulares.length} titular(es)
                </span>
              </div>
              <textarea
                rows={11}
                placeholder={'Um jogador por linha\n(ou envie o print acima)'}
                value={manual || e.titulares.join('\n')}
                onChange={(x) =>
                  setR((y) => ({
                    ...y,
                    escalacaoManual: { ...y.escalacaoManual, [t]: x.target.value },
                  }))
                }
              />
              <p className="miudo">
                {e.origem === 'manual'
                  ? 'Editada por você.'
                  : e.origem === 'print'
                    ? 'Lida do print: corrija direto na lista.'
                    : 'Sem escalação ainda.'}
                {e.tecnico && ` Técnico: ${e.tecnico}.`}
                {e.reservas.length > 0 && ` Reservas: ${e.reservas.join(', ')}.`}
              </p>
              {manual && (
                <button
                  className="mini"
                  onClick={() =>
                    setR((y) => ({ ...y, escalacaoManual: { ...y.escalacaoManual, [t]: '' } }))
                  }
                >
                  Voltar à leitura do print
                </button>
              )}
            </div>
          );
        })}
      </div>
      {esc.conferida && (
        <div className="caixa ok miudo">
          ✅ Escalação conferida (conta para DQ A)
          {esc.incerta
            ? ': ainda provável, então o gate sobe +1 pp e o modelo pesa menos.'
            : esc.status === 'confirmada'
              ? ': confirmada.'
              : '.'}
        </div>
      )}
    </section>
  );
}
