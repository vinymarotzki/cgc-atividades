import { describe, expect, it } from "vitest";
import { mapMessageToIdrRecord } from "./idr-mapper";
import type { SasiDataField, SasiProviderMessage } from "@/lib/sasi-api/types";

function field(name: string, value: number | string): SasiDataField {
  return { name, value };
}

function buildMessage(fields: SasiDataField[], id = 1): SasiProviderMessage {
  return { id, data_fields: fields };
}

describe("mapMessageToIdrRecord", () => {
  it("maps a full message into an IdrRecord", () => {
    const message = buildMessage([
      field("ano", 2025),
      field("quantidade_total_de_ocorrencia_rede_estadual", 1073),
      field("quantidades_de_estudantes_rede_estadual", 42260),
      field("quantidade_pratica_desportiva_rede_estadual", 80),
      field("quantidade_de_emergencias_clinicas_rede_estadual", 55),
      field("quantidade_de_quedas_pessoas_rede_estadual", 35),
      field("quantidades_de_acidentes_diversos_rede_estadual", 28),
      field("quantidade_total_de_ocorrencia_rede_municipal", 891),
      field("quantidades_de_estudantes_rede_municipal", 33000),
      field("quantidade_total_de_ocorrencia_rede_particular", 405),
      field("quantidades_de_estudantes_rede_particular", 15000),
    ]);

    const record = mapMessageToIdrRecord(message);

    expect(record).not.toBeNull();
    expect(record?.messageId).toBe(1);
    expect(record?.ano).toBe(2025);
    expect(record?.redes.estadual).toEqual({
      ocorrencias: 1073,
      estudantes: 42260,
      praticaDesportiva: 80,
      emergenciasClinicas: 55,
      quedas: 35,
      acidentesDiversos: 28,
    });
    expect(record?.redes.municipal.ocorrencias).toBe(891);
    expect(record?.redes.municipal.praticaDesportiva).toBe(0);
    expect(record?.redes.particular.estudantes).toBe(15000);
  });

  it("returns null when the ano field is missing", () => {
    const message = buildMessage([
      field("quantidade_total_de_ocorrencia_rede_estadual", 100),
    ]);

    expect(mapMessageToIdrRecord(message)).toBeNull();
  });

  it("returns null when the message has no id", () => {
    const message = buildMessage([field("ano", 2025)]);
    delete (message as { id?: number }).id;

    expect(mapMessageToIdrRecord(message)).toBeNull();
  });

  it("parses formattedValue text when value is absent", () => {
    const message = buildMessage([
      { name: "ano", formattedValue: "2024" },
      { name: "quantidade_total_de_ocorrencia_rede_estadual", formattedValue: "1.180" },
    ]);

    const record = mapMessageToIdrRecord(message);

    expect(record?.ano).toBe(2024);
    expect(record?.redes.estadual.ocorrencias).toBe(1180);
  });
});
