/**
 * Nomes dos campos do formulário do canal SASI 36602 (ocorrências pro IDR).
 * Confirmados pelo usuário — canal ainda sem mensagens no momento em que
 * este mapeamento foi escrito, mas o formulário já estava definido. Ao
 * contrário de field-map.ts (canal 33397), não há override por env var
 * aqui: o formulário do 36602 não foi observado em produção ainda, então
 * não há histórico de rename pra proteger.
 */

export type IdrRede = "estadual" | "municipal" | "particular";

export const IDR_REDES: IdrRede[] = ["estadual", "municipal", "particular"];

export type IdrCategoria =
  | "praticaDesportiva"
  | "emergenciasClinicas"
  | "quedas"
  | "acidentesDiversos";

export const IDR_CATEGORIAS: IdrCategoria[] = [
  "praticaDesportiva",
  "emergenciasClinicas",
  "quedas",
  "acidentesDiversos",
];

const CATEGORIA_FIELD_PREFIX: Record<IdrCategoria, string> = {
  praticaDesportiva: "quantidade_pratica_desportiva_rede",
  emergenciasClinicas: "quantidade_de_emergencias_clinicas_rede",
  quedas: "quantidade_de_quedas_pessoas_rede",
  acidentesDiversos: "quantidades_de_acidentes_diversos_rede",
};

export const IDR_FIELD_ANO = "ano";

export function fieldNameOcorrenciasTotal(rede: IdrRede): string {
  return `quantidade_total_de_ocorrencia_rede_${rede}`;
}

export function fieldNameEstudantes(rede: IdrRede): string {
  return `quantidades_de_estudantes_rede_${rede}`;
}

export function fieldNameCategoria(categoria: IdrCategoria, rede: IdrRede): string {
  return `${CATEGORIA_FIELD_PREFIX[categoria]}_${rede}`;
}
