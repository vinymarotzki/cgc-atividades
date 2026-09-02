/**
 * "Hoje" no fuso do CGC, não do servidor. O deploy roda em UTC (Vercel) e as
 * mensagens da API SASI só trazem timestamp UTC — sem fixar um fuso, a
 * virada do dia bateria errado com o horário local (ex.: 21h em Campo Grande
 * já é meia-noite UTC, viraria "amanhã" pro servidor sem essa conversão).
 */
export const CGC_TIMEZONE = "America/Campo_Grande";

const CUTOFF_ENV_KEY = "CGC_DISPLAY_CUTOFF_DATE";

/** Formata uma data como YYYY-MM-DD no fuso informado, pra comparar por dia. */
function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);
}

/**
 * Data de corte da listagem, no formato YYYY-MM-DD. Configurável via
 * CGC_DISPLAY_CUTOFF_DATE pra não travar atividade pendente atrás de uma
 * janela rolante de dias (ex.: item de 31/08 ainda NAO_INICIADO não pode
 * sumir só porque hoje já é 02/09) — redefinir o corte é só trocar a env var.
 * Sem env definida, o corte é hoje, mesmo comportamento original.
 */
function cutoffKey(timeZone: string): string {
  const raw = process.env[CUTOFF_ENV_KEY]?.trim();
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return dayKey(new Date(), timeZone);
}

/**
 * Diz se o ISO informado cai no corte configurado ou depois dele, no fuso do
 * CGC. ISO inválido/ausente nunca entra na janela.
 */
export function isFromCutoffOnward(iso: string | null | undefined, timeZone: string = CGC_TIMEZONE): boolean {
  if (!iso) return false;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  return dayKey(date, timeZone) >= cutoffKey(timeZone);
}
