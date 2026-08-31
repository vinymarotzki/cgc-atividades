/**
 * "Hoje" no fuso do CGC, não do servidor. O deploy roda em UTC (Vercel) e as
 * mensagens da API SASI só trazem timestamp UTC — sem fixar um fuso, a
 * virada do dia bateria errado com o horário local (ex.: 21h em Campo Grande
 * já é meia-noite UTC, viraria "amanhã" pro servidor sem essa conversão).
 */
export const CGC_TIMEZONE = "America/Campo_Grande";

/** Formata uma data como YYYY-MM-DD no fuso informado, pra comparar por dia. */
function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);
}

/** Diz se o ISO informado cai no mesmo dia local que agora. ISO inválido/ausente nunca é "hoje". */
export function isToday(iso: string | null | undefined, timeZone: string = CGC_TIMEZONE): boolean {
  if (!iso) return false;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  return dayKey(date, timeZone) === dayKey(new Date(), timeZone);
}
