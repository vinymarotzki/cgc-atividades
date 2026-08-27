/**
 * Busca as mensagens do canal 36602 (formulário de ocorrências pro IDR) na
 * API SASI e mapeia pra IdrRecord. Único ponto que sabe o id do canal —
 * troque IDR_CHANNEL_ID aqui se o canal mudar.
 */

import { fetchProviderMessages, SASI_MESSAGES_MAX_LIMIT } from "@/lib/sasi-api/messages";
import { mapMessageToIdrRecord, type IdrRecord } from "./idr-mapper";

export const IDR_CHANNEL_ID = "36602";

const SCAN_CAP = Number(process.env.SASI_IDR_SCAN_CAP) > 0
  ? Number(process.env.SASI_IDR_SCAN_CAP)
  : 500;

/** Busca e mapeia todas as mensagens do canal 36602, paginando até SCAN_CAP. */
export async function fetchIdrRecords(token: string): Promise<IdrRecord[]> {
  const records: IdrRecord[] = [];
  let scanned = 0;
  let page = 1;

  while (scanned < SCAN_CAP) {
    const batch = await fetchProviderMessages(
      { channel_ids: IDR_CHANNEL_ID, page, limit: SASI_MESSAGES_MAX_LIMIT },
      { token }
    );
    scanned += batch.length;

    for (const message of batch) {
      const record = mapMessageToIdrRecord(message);
      if (record) records.push(record);
    }

    if (batch.length < SASI_MESSAGES_MAX_LIMIT) break;
    page += 1;
  }

  return records;
}
