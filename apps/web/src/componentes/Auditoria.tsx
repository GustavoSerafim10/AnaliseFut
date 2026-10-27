/**
 * Auditoria do processamento: as etapas que o motor REALMENTE executa, cada uma com o seu
 * estado real (feito, com alerta, falhou ou pendente). Nada aparece como concluído sem ter
 * acontecido. Etapas que o motor ainda não tem (correlação do lote, simulação) não aparecem.
 */
import type { Derivado } from '../dados';
import type { Rascunho } from '../estado';
import { Icone } from './ui';

type Estado = 'ok' | 'alerta' | 'falha' | 'pendente';

interface Etapa {
  nome: string;
  estado: Estado;
  detalhe: string;
}

const n2 = (x: number) => x.toFixed(2).replace('.', ',');

export function etapasDoPipeline(r: Rascunho, d: Derivado): Etapa[] {
  const v = d.v4;
  const temJogo = !!(r.jogo.casa && r.jogo.fora && r.jogo.hora);
  const casas = new Set(r.odds.map((o) => o.casa)).size;
  const acima = v?.avaliadas.filter((a) => a.evMinimo !== null && a.ev >= a.evMinimo).length ?? 0;
  const nivel = v?.referencia.nivel;
  return [
    {
      nome: 'Jogo',
      estado: temJogo ? 'ok' : 'falha',
      detalhe: temJogo
        ? `${r.jogo.data.split('-').reverse().join('/')} ${r.jogo.hora}`
        : 'faltam times ou hora',
    },
    {
      nome: 'Odds',
      estado: d.errosOdds ? 'falha' : r.odds.length ? 'ok' : 'pendente',
      detalhe: d.errosOdds
        ? `${d.errosOdds} erro(s) de leitura`
        : r.odds.length
          ? `${r.odds.length} odds · ${casas} casa(s)`
          : 'nenhuma odd lida',
    },
    {
      nome: 'Referência',
      estado: !v ? 'pendente' : nivel === 'R1' || nivel === 'R2' ? 'ok' : 'alerta',
      detalhe: !v
        ? 'aguardando odds'
        : nivel === 'R1'
          ? `R1 · ${v.referencia.afiadas.join(', ')}`
          : nivel === 'R2'
            ? 'R2 · consenso de 4+ casas'
            : `${nivel} · sem Pinnacle/Betfair nem 4 casas`,
    },
    {
      nome: 'De-vig',
      estado: v ? 'ok' : 'pendente',
      detalhe: v ? `${v.avaliadas.length + v.descartados.length} seleções` : '—',
    },
    {
      nome: 'Modelo λ',
      estado: d.lambda ? 'ok' : 'alerta',
      detalhe: d.lambda
        ? `${n2(d.lambda.lambdas.casa)} × ${n2(d.lambda.lambdas.fora)}`
        : 'sem estatísticas: apoio desligado',
    },
    {
      nome: 'EV e gates',
      estado: v ? 'ok' : 'pendente',
      detalhe: v ? `${v.avaliadas.length} avaliados · ${acima} acima do gate` : '—',
    },
    {
      nome: 'Filtro do modelo',
      estado: !v?.melhor ? 'pendente' : v.melhor.filtro === 'discorda' ? 'alerta' : 'ok',
      detalhe: v?.melhor ? v.melhor.filtro : '—',
    },
    {
      nome: 'Banca',
      estado: !d.travas ? 'alerta' : d.travas.pausadoAte || d.travas.diaEncerrado ? 'falha' : 'ok',
      detalhe: !d.travas
        ? 'banca separada não definida'
        : d.travas.pausadoAte
          ? 'pausa ativa'
          : d.travas.diaEncerrado
            ? 'dia encerrado'
            : `drawdown ${(d.travas.drawdown * 100).toFixed(0)}%`,
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
  return (
    <section className="painel">
      <div className="painel-titulo">
        <Icone nome="engrenagem" /> Auditoria e processamento
        <span className={`painel-sub ${confiavel ? 'positivo' : ''}`}>
          <span className={`ponto ${confiavel ? 'ponto-ok' : 'ponto-alerta'}`} />
          {confiavel ? 'pipeline completo' : 'com pendências'}
        </span>
      </div>
      <ol className="pipeline">
        {etapas.map((e, i) => (
          <li
            key={e.nome}
            className={`etapa etapa-${e.estado}`}
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <span className="etapa-no" aria-label={e.estado}>
              <Icone nome={ICONE[e.estado]} tamanho={16} />
            </span>
            <span className="etapa-nome">{e.nome}</span>
            <span className="etapa-detalhe">{e.detalhe}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
