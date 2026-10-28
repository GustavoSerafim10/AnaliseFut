import { UploadPrints } from '../componentes/UploadPrints';
import { acoesPrints, type PropsAba } from './tipos';

const ROTULO_STATUS = { provavel: 'provável', confirmada: 'confirmada' } as const;

export function AbaTabela({ r, setR, d }: PropsAba) {
  const semTimes = !r.jogo.casa || !r.jogo.fora;
  const nome = (t: 'casa' | 'fora') => (t === 'casa' ? r.jogo.casa : r.jogo.fora);
  const esc = d.escalacao;
  return (
    <section className="passo">
      <h2>Classificação, desfalques e escalações</h2>

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
        dica='Flashscore ou SofaScore → página do jogo → "Escalações": print do campo com os dois times (e, se quiser, dos reservas). Esquerda = mandante, direita = visitante.'
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
