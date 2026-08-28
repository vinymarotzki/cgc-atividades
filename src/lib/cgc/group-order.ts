/**
 * Ordem fixa de exibição dos grupos semeados, usada em toda tela que lista
 * grupos (seleção, histórico). Grupos criados depois (fora dessa lista)
 * aparecem ao final, na ordem em que a API os devolve.
 */
export const GROUP_DISPLAY_ORDER = ["CGC", "AVA", "NUPPAE", "NGOA", "CIPA"];

export function sortGroupsByDisplayOrder<T extends { name: string }>(groups: T[]): T[] {
  return [...groups].sort((a, b) => {
    const indexA = GROUP_DISPLAY_ORDER.indexOf(a.name.trim().toUpperCase());
    const indexB = GROUP_DISPLAY_ORDER.indexOf(b.name.trim().toUpperCase());
    const rankA = indexA === -1 ? GROUP_DISPLAY_ORDER.length : indexA;
    const rankB = indexB === -1 ? GROUP_DISPLAY_ORDER.length : indexB;
    return rankA - rankB;
  });
}
