/**
 * Mapeamento puro de ProviderMessageComposed (API SASI, canal 36602) pros
 * números que alimentam o IDR. Nada aqui faz rede — só leitura de
 * data_fields. Regra geral herdada de mapper.ts: nunca lança por causa de
 * campo ausente ou tipo inesperado, vira 0/null.
 */

import type { SasiDataField, SasiProviderMessage } from "@/lib/sasi-api/types";
import {
  fieldNameCategoria,
  fieldNameEstudantes,
  fieldNameOcorrenciasTotal,
  IDR_CATEGORIAS,
  IDR_FIELD_ANO,
  IDR_REDES,
  type IdrCategoria,
  type IdrRede,
} from "./idr-field-map";

export interface IdrRedeMetrics {
  ocorrencias: number;
  estudantes: number;
  praticaDesportiva: number;
  emergenciasClinicas: number;
  quedas: number;
  acidentesDiversos: number;
}

export interface IdrRecord {
  messageId: number;
  ano: number;
  redes: Record<IdrRede, IdrRedeMetrics>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toDataFields(message: SasiProviderMessage): SasiDataField[] {
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

function findField(fields: SasiDataField[], wantedName: string): SasiDataField | null {
  const wanted = wantedName.trim().toLowerCase();
  for (const field of fields) {
    if (typeof field.name === "string" && field.name.trim().toLowerCase() === wanted) {
      return field;
    }
  }
  return null;
}

/**
 * Extrai um inteiro de um campo. Prioriza `value` numérico; cai pra
 * `value`/`formattedValue` como texto, descartando tudo que não é dígito ou
 * hífen — estes campos são sempre contagens inteiras, nunca decimais, então
 * não há ambiguidade de separador decimal/milhar a resolver.
 */
function toNumber(field: SasiDataField | null): number {
  if (!field) return 0;

  if (typeof field.value === "number" && Number.isFinite(field.value)) {
    return field.value;
  }
  if (typeof field.value === "string") {
    const parsed = Number.parseInt(field.value.replace(/[^\d-]/g, ""), 10);
    if (Number.isFinite(parsed)) return parsed;
  }

  const formatted = Array.isArray(field.formattedValue)
    ? field.formattedValue[0]
    : field.formattedValue;
  if (typeof formatted === "string") {
    const parsed = Number.parseInt(formatted.replace(/[^\d-]/g, ""), 10);
    if (Number.isFinite(parsed)) return parsed;
  }

  return 0;
}

function readRedeMetrics(fields: SasiDataField[], rede: IdrRede): IdrRedeMetrics {
  const categorias = {} as Record<IdrCategoria, number>;
  for (const categoria of IDR_CATEGORIAS) {
    categorias[categoria] = toNumber(findField(fields, fieldNameCategoria(categoria, rede)));
  }

  return {
    ocorrencias: toNumber(findField(fields, fieldNameOcorrenciasTotal(rede))),
    estudantes: toNumber(findField(fields, fieldNameEstudantes(rede))),
    praticaDesportiva: categorias.praticaDesportiva,
    emergenciasClinicas: categorias.emergenciasClinicas,
    quedas: categorias.quedas,
    acidentesDiversos: categorias.acidentesDiversos,
  };
}

/**
 * Converte uma mensagem do canal 36602 num IdrRecord. Retorna null se faltar
 * id ou "ano" válido — sem ano não dá pra decidir em que snapshot a mensagem
 * entra, então ela é descartada em vez de virar um registro incompleto.
 */
export function mapMessageToIdrRecord(message: SasiProviderMessage): IdrRecord | null {
  if (typeof message.id !== "number") return null;

  const fields = toDataFields(message);
  const ano = toNumber(findField(fields, IDR_FIELD_ANO));
  if (!ano) return null;

  const redes = {} as Record<IdrRede, IdrRedeMetrics>;
  for (const rede of IDR_REDES) {
    redes[rede] = readRedeMetrics(fields, rede);
  }

  return { messageId: message.id, ano, redes };
}
