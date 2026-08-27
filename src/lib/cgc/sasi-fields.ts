/**
 * Utilidades compartilhadas para extrair dados de SasiDataField.
 * Herdadas de mapper.ts, reutilizadas por idr-mapper.ts.
 */

import type { SasiDataField, SasiProviderMessage } from "@/lib/sasi-api/types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `data_fields` chega como array; aceita também objeto indexado e raw.dataFields.
 */
export function toDataFields(message: SasiProviderMessage): SasiDataField[] {
  const candidates: unknown[] = [message.data_fields, message.raw?.dataFields];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(isRecord) as SasiDataField[];
    }
    if (isRecord(candidate)) {
      const values = Object.values(candidate).filter(isRecord);
      if (values.length > 0) return values as SasiDataField[];
    }
  }

  return [];
}
