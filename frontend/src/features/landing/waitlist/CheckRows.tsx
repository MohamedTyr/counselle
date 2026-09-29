import check from "../assets/plan-check-circle.svg";

export function CheckRows({ rows }: { rows: string[] }) {
  return (
    <ul className="lp-wl-rows">
      {rows.map((row) => (
        <li key={row}>
          <img src={check} width={18} height={18} alt="" />
          {row}
        </li>
      ))}
    </ul>
  );
}
