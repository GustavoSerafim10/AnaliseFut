/**
 * Auditoria do processamento: as etapas que o motor REALMENTE executa, cada uma com o seu
 * estado real (feito, com alerta, falhou ou pendente) e o horário real das odds usadas.
 * Nada aparece como concluído sem ter acontecido; etapas que o motor não tem (correlação do
 * lote, simulação) não aparecem.
 */
import type { Derivado } from '../dados';
import type { Rascunho } from '../estado';
import { rotuloCurto } from './ComparativoOdds';
import { Icone } from './ui';

type Estado = 'ok' | 'alerta' | 'falha' | 'pendente';

export interface Etapa {
  nome: string;
  estado: Estado;
  detalhe: string;
}

const n2 = (x: number) => x.toFixed(2).replace('.', ',');
/** "2026-10-27T17:42:00-03:00" → "27/10 • 17:42" */
const quando = (iso?: string) =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)} • ${iso.slice(11, 16)}` : '';

export function etapasDoPipeline(r: Rascunho, d: Derivado): Etapa[] {
  const v = d.v4;
  const m = v?.melhor;
  const temJogo = !!(r.jogo.casa && r.jogo.fora && r.jogo.hora);
  const coleta = r.odds
    .map((o) => o.horarioColeta)
    .filter((h): h is string => !!h)
    .sort()
    .at(-1);
  const nivel = v?.referencia.nivel;
  // avaliadas já vem ordenada pelo motor (folga sobre o gate)
  const primeiro = v?.avaliadas[0];
  const acimaDoGate = v?.avaliadas.filter((a) => a.evMinimo !== null && a.ev >= a.evMinimo).length;
  const t = d.travas;
  const travado = !!(t?.pausadoAte || t?.diaEncerrado);
  const risco = [
    v?.sensibilidade && `λ ${v.sensibilidade.classe.toLowerCase()}`,
    m?.stake && `stake ${(m.stake.fracaoBanca * 100).toFixed(1).replace('.', ',')}%`,
    travado && 'banca travada',
  ].filter(Boolean);
  return [
    {
      nome: 'Contexto',
      estado: !temJogo
        ? 'falha'
        : !r.odds.length
          ? 'pendente'
          : !d.oddsValidas.length
            ? 'falha'
            : d.errosOdds
              ? 'alerta'
              : 'ok',
      detalhe: !temJogo
        ? 'faltam times ou hora'
        : d.errosOdds
          ? `${d.errosOdds} odd(s) com erro fora da análise`
          : r.odds.length
            ? quando(coleta) || `${r.odds.length} odds`
            : 'nenhuma odd lida',
    },
    {
      nome: 'Modelo',
      estado: d.lambda ? 'ok' : 'alerta',
      detalhe: d.lambda
        ? `λ ${n2(d.lambda.lambdas.casa)} × ${n2(d.lambda.lambdas.fora)} · DQ ${d.dqFinal.dq}${primeiro ? ` · ${primeiro.filtro}` : ''}`
        : 'sem estatísticas: só mercado',
    },
    {
      nome: 'De-vig',
      estado: v ? 'ok' : 'pendente',
      detalhe: v ? `${v.avaliadas.length + v.descartados.length} seleções` : '—',
    },
    {
      nome: 'Referência',
      estado: !v ? 'pendente' : nivel === 'R1' || nivel === 'R2' ? 'ok' : 'alerta',
      detalhe: !v
        ? '—'
        : nivel === 'R1'
          ? `R1 · ${v.referencia.afiadas.join(', ')}`
          : nivel === 'R2'
            ? 'R2 · consenso 4+ casas'
            : `${nivel} · sem referência`,
    },
    {
      nome: 'Value · gate',
      estado: !v ? 'pendente' : 'ok',
      detalhe: !v
        ? '—'
        : `${acimaDoGate} acima do gate${m?.oddMinima ? ` · odd ≥ ${n2(m.oddMinima)}` : ''}`,
    },
    {
      nome: 'Ranking',
      estado: !v ? 'pendente' : primeiro ? 'ok' : 'alerta',
      detalhe: primeiro ? `1º ${rotuloCurto(primeiro.linha)}` : v ? 'nenhum mercado' : '—',
    },
    {
      nome: 'Risco',
      estado: !v ? 'pendente' : travado ? 'alerta' : 'ok',
      detalhe: !v ? '—' : risco.join(' · ') || (t ? 'travas ok' : 'travas desligadas'),
    },
    {
      nome: 'Decisão',
      estado: !v ? 'pendente' : v.decisao === 'INVESTIGAR' ? 'alerta' : 'ok',
      detalhe: v ? v.decisao.replace('_', ' ') : '—',
    },
  ];
}

const ICONE: Record<Estado, 'check' | 'alerta' | 'x' | 'relogio'> = {
  ok: 'check',
  alerta: 'alerta',
  falha: 'x',
  pendente: 'relogio',
};

export function Auditoria({ r, d }: { r: Rascunho; d: Derivado }) {
  const etapas = etapasDoPipeline(r, d);
  const confiavel = etapas.every((e) => e.estado === 'ok');
  const t = d.travas;
  return (
    <section className="painel">
      <div className="painel-titulo">
        <Icone nome="engrenagem" /> Auditoria e processamento
        <span className={`painel-sub ${confiavel ? 'positivo' : ''}`}>
          <span className={`ponto ${confiavel ? 'ponto-ok' : 'ponto-alerta'}`} />
          {confiavel ? 'DADOS CONFIÁVEIS' : 'COM PENDÊNCIAS'}
        </span>
      </div>
      <ol className="pipeline">
        {etapas.map((e, i) => (
          <li
            key={e.nome}
            className={`etapa etapa-${e.estado}${i === 0 ? ' etapa-primeira' : ''}`}
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <span className="etapa-no" aria-label={e.estado}>
              <Icone nome={ICONE[e.estado]} tamanho={18} />
            </span>
            <span className="etapa-nome">{e.nome}</span>
            <span className="etapa-detalhe">{e.detalhe}</span>
          </li>
        ))}
      </ol>
      <p className="miudo banca-linha">
        <Icone nome="escudo" tamanho={14} />{' '}
        {!t
          ? 'Banca separada não definida (aba Histórico): travas desligadas.'
          : t.pausadoAte
            ? 'Banca em pausa (drawdown de 30%).'
            : t.diaEncerrado
              ? 'Dia encerrado: 5 perdas.'
              : `Banca: drawdown ${(t.drawdown * 100).toFixed(0)}% · hoje ${(t.expostoHoje * 100).toFixed(1)}% de 6%.`}
      </p>
    </section>
  );
}
