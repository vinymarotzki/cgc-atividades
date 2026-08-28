/**
 * Histórico das Atividades do CGC.
 * Só leitura — as entradas são gravadas pelas rotas de status e de comentários.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listHistory } from "@/lib/cgc/history";
import { listGroups } from "@/lib/cgc/groups";
import { getGroupCounts } from "@/lib/cgc/status-store";
import { getLiveGroupTotals } from "@/lib/cgc/group-totals";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  try {
    const [history, groups] = await Promise.all([listHistory(), listGroups()]);
    // Mesma lógica de /api/cgc/groups: total "solicitado" ao vivo (cacheado),
    // com fallback pro total local se a API SASI falhar.
    const [counts, liveTotals] = await Promise.all([
      getGroupCounts().catch(
        () =>
          ({} as Record<
            string,
            { total: number; concluded: number; blocked: number; inProgress: number }
          >)
      ),
      getLiveGroupTotals(groups, auth.token).catch(() => ({} as Record<string, number>)),
    ]);

    return NextResponse.json({
      history,
      groups: groups.map((group) => {
        const total = liveTotals[group.id] ?? counts[group.id]?.total ?? 0;
        const concluded = counts[group.id]?.concluded ?? 0;
        const inProgress = counts[group.id]?.inProgress ?? 0;
        const blocked = counts[group.id]?.blocked ?? 0;

        return {
          id: group.id,
          name: group.name,
          concluded,
          total,
          // "Não iniciado" é o status padrão: toda atividade que chega e ainda
          // não foi tratada (sem linha em cgc_activity_status) já conta aqui,
          // então não dá pra contar via cgc_history — precisa do total ao
          // vivo menos o que já saiu desse status.
          notStarted: Math.max(0, total - concluded - inProgress - blocked),
        };
      }),
      user: auth.user,
    });
  } catch {
    return NextResponse.json({ error: "Falha ao carregar o histórico." }, { status: 500 });
  }
}
