/**
 * Resumo de atividades concluídas do CGC por grupo, para a página /controle.
 *
 * Era rota pública de propósito (ver /api/controle/checklists) enquanto os
 * dois apps rodavam no mesmo processo; agora que o sasi-checklist chama por
 * HTTP através da rede, exige o header x-controle-secret igual a
 * CONTROLE_PROXY_SECRET — sem isso qualquer um que descubra a URL do sasi-cgc
 * leria descrições e responsáveis do CGC. Números vêm do acompanhamento
 * local (cgc_activity_status), igual ao card de cada grupo em
 * /atividades-cgc — não escaneia a API SASI.
 */

import { NextRequest, NextResponse } from "next/server";
import { listGroups } from "@/lib/cgc/groups";
import { getConcludedCountByGroup } from "@/lib/cgc/status-store";

export async function GET(req: NextRequest) {
  const controleProxySecret = process.env.CONTROLE_PROXY_SECRET;
  if (
    !controleProxySecret ||
    req.headers.get("x-controle-secret") !== controleProxySecret
  ) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const [groups, concluded] = await Promise.all([
      listGroups(),
      getConcludedCountByGroup(),
    ]);

    return NextResponse.json({
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        concluded: concluded[group.id] ?? 0,
      })),
    });
  } catch {
    return NextResponse.json({ error: "Falha ao carregar o resumo do CGC." }, { status: 500 });
  }
}
