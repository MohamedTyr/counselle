import { useSearchParams } from "react-router";

/* The selected section of the rail, kept in `?section=` so it is linkable. */

const SECTION_PARAM = "section";

export type ShellSection = { id: string; title: string };

export function useSelectedSection(
  sections: ShellSection[],
): [string, (id: string) => void] {
  const [params, setParams] = useSearchParams();
  const requested = params.get(SECTION_PARAM);
  const selected =
    sections.find((s) => s.id === requested)?.id ?? sections[0]?.id ?? "";
  const select = (id: string) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set(SECTION_PARAM, id);
        return next;
      },
      { replace: true },
    );
  };
  return [selected, select];
}
