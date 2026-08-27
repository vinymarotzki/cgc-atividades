/**
 * Dados de ocorrência do canal 36602 (SASI), pro cgc-idr calcular o IDR.
 *
 * Servidor-a-servidor, igual aos outros /controle routes: exige
 * x-idr-secret == CGC_IDR_PROXY_SECRET. Secret dedicado (não
 * CONTROLE_PROXY_SECRET) pra poder girar essa credencial sem afetar a
 * integração com o cgc-checklist. Sem sasi-token de usuário — não há sessão
 * pra encaminhar nessa chamada.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveSasiToken, SasiApiError } from "@/lib/sasi-api/client";
import { fetchIdrRecords } from "@/lib/cgc/idr-client";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const idrProxySecret = process.env.CGC_IDR_PROXY_SECRET;
  if (!idrProxySecret || req.headers.get("x-idr-secret") !== idrProxySecret) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const token = resolveSasiToken(null);
  if (!token) {
    return NextResponse.json({ error: "SASI_API_TOKEN não configurado." }, { status: 500 });
  }

  try {
    const records = await fetchIdrRecords(token);
    return NextResponse.json({ records });
  } catch (error) {
    if (error instanceof SasiApiError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    return NextResponse.json({ error: "Erro ao consultar a API SASI." }, { status: 502 });
  }
}
