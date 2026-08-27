/**
 * Grava IdrRecord direto no Turso do projeto cgc-idr — não no nosso banco.
 * O canal 36602 chega só via webhook (provider SASI separado, tipo
 * "webhook"), nunca aparece em GET /provider/messages da nossa PAT token
 * (provider diferente). Por isso não dá pra expor um endpoint de leitura
 * como o de Atividades: escrevemos direto no banco que o cgc-idr já lê,
 * mesmo schema de idr_snapshots (ver cgc-idr/src/lib/db.ts).
 */

import { createClient } from "@libsql/client";
import { IDR_REDES, type IdrRede } from "./idr-field-map";
import type { IdrRecord } from "./idr-mapper";

let client: ReturnType<typeof createClient> | null = null;
let readyPromise: Promise<void> | null = null;

function getIdrDb() {
  if (!client) {
    const url = process.env.IDR_TURSO_DATABASE_URL;
    const authToken = process.env.IDR_TURSO_AUTH_TOKEN;

    if (!url) {
      throw new Error("IDR_TURSO_DATABASE_URL não configurado.");
    }

    client = createClient({ url, authToken: authToken || undefined });
  }
  return client;
}

/**
 * Mesmo DDL de cgc-idr/src/lib/db.ts — não dá pra assumir que o cgc-idr já
 * rodou em produção e criou a tabela antes de nós.
 */
async function ensureTable(): Promise<void> {
  if (!readyPromise) {
    readyPromise = getIdrDb()
      .execute(
        `
        CREATE TABLE IF NOT EXISTS idr_snapshots (
          ano INTEGER NOT NULL,
          rede TEXT NOT NULL,
          ocorrencias_total INTEGER NOT NULL DEFAULT 0,
          estudantes INTEGER NOT NULL DEFAULT 0,
          ocorrencias_pratica_desportiva INTEGER NOT NULL DEFAULT 0,
          ocorrencias_emergencias_clinicas INTEGER NOT NULL DEFAULT 0,
          ocorrencias_quedas INTEGER NOT NULL DEFAULT 0,
          ocorrencias_acidentes_diversos INTEGER NOT NULL DEFAULT 0,
          synced_at TEXT NOT NULL,
          PRIMARY KEY (ano, rede)
        )
      `
      )
      .then(() => undefined)
      .catch((error) => {
        readyPromise = null;
        throw error;
      });
  }
  return readyPromise;
}

/** Upsert por (ano, rede) — mesma regra do cgc-idr: último sync vence. */
export async function storeIdrRecord(record: IdrRecord): Promise<void> {
  await ensureTable();
  const db = getIdrDb();
  const syncedAt = new Date().toISOString();

  for (const rede of IDR_REDES as IdrRede[]) {
    const metrics = record.redes[rede];
    if (!metrics) continue;

    await db.execute({
      sql: `
        INSERT INTO idr_snapshots (
          ano, rede, ocorrencias_total, estudantes,
          ocorrencias_pratica_desportiva, ocorrencias_emergencias_clinicas,
          ocorrencias_quedas, ocorrencias_acidentes_diversos, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (ano, rede) DO UPDATE SET
          ocorrencias_total = excluded.ocorrencias_total,
          estudantes = excluded.estudantes,
          ocorrencias_pratica_desportiva = excluded.ocorrencias_pratica_desportiva,
          ocorrencias_emergencias_clinicas = excluded.ocorrencias_emergencias_clinicas,
          ocorrencias_quedas = excluded.ocorrencias_quedas,
          ocorrencias_acidentes_diversos = excluded.ocorrencias_acidentes_diversos,
          synced_at = excluded.synced_at
      `,
      args: [
        record.ano,
        rede,
        metrics.ocorrencias,
        metrics.estudantes,
        metrics.praticaDesportiva,
        metrics.emergenciasClinicas,
        metrics.quedas,
        metrics.acidentesDiversos,
        syncedAt,
      ],
    });
  }
}
