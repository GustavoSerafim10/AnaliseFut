/**
 * Texto como o OCR devolveria um print da 1win (Villa × Viking, 21/10/2026).
 * Montado a partir do formato descrito; trocar por saídas reais do Tesseract quando houver prints.
 */
export const OCR_1WIN_VILLA = `
09:30 ⚡ 4G 87%
1win
Aston Villa - Viking
Resultado do tempo regulamentar
V1 1,24 X 6,5 V2 11,2
Total
Abaixo De 2.5 3.55 | Acima De 2.5 1.29
Abaixo De 3.5 2.09 | Acima De 3.5 1.73
Abaixo De 4.5 1.51 | Acima De 4.5 2.54
Aston Villa total
Abaixo De 1.5 4.34 | Acima De 1.5 1.21
Abaixo De 2.5 2.22 | Acima De 2.5 1.65
Abaixo De 3.5 1.51 | Acima De 3.5 2.55
Viking total
Abaixo De 0.5 2.40 | Acima De 0.5 1.57
Abaixo De 1.5 1.27 | Acima De 1.5 3.72
Handicap
Aston Villa -1.5 1.61 | Viking 1.5 2.24
Ambos os times marcarão
Sim 1.62 | Não 2.20
`;

/** Mesmo mercado de totais em forma de tabela. */
export const OCR_1WIN_TABELA = `
1win
Total
Abaixo De Acima De
2.5 3.55 1.29
3.5 2.09 1.73
`;

export const OCR_SOFASCORE = `
Sofascore
Estatísticas
Gols esperados (xG) 1.85 0.92
Grandes chances 3 1
`;

export const OCR_LIXO = `
Configurações
Notificações ativadas
Bateria 45
`;
