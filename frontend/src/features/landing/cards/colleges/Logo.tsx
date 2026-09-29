import type { School } from "./data";

export function Logo({ school, size }: { school: School; size: number }) {
  return (
    <span className="lp-cx-logo" style={{ width: size, height: size }}>
      <img src={school.logo} alt="" />
    </span>
  );
}
