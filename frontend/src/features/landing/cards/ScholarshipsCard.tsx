import tick from "../assets/tick.svg";
import "./scholarships-card.css";

const STREAM: { name: string; amount?: string }[] = [
  { name: "Michigan Competitive", amount: "$1,500" },
  { name: "Gates Scholarship" },
  { name: "Elks Most Valuable Student" },
  { name: "Coca-Cola Scholars", amount: "$20,000" },
  { name: "Horatio Alger National" },
  { name: "Udall Scholarship", amount: "$7,000" },
  { name: "Jack Kent Cooke College" },
  { name: "Brower Youth Award", amount: "$3,000" },
  { name: "Burger King Scholars" },
  { name: "Dell Scholars Program" },
  { name: "Davidson Fellows" },
  { name: "Hispanic Scholarship Fund" },
];

export function ScholarshipsSheet() {
  return (
    <div className="lp-sheet lp-sheet-third" aria-hidden="true">
      <div className="lp-stream">
        {[0, 1].map((copy) => (
          <div
            key={copy}
            data-scroll-cycle
            aria-hidden={copy === 1 ? true : undefined}
            className="lp-stream-cycle"
            style={{ height: STREAM.length * 26 }}
          >
            {STREAM.map((item, index) =>
              item.amount ? (
                <div
                  key={item.name}
                  className="lp-stream-match"
                  style={{ top: index * 26 }}
                >
                  <img
                    className="lp-stream-tick"
                    src={tick}
                    width={10}
                    height={10}
                    alt=""
                  />
                  <span className="lp-stream-name">{item.name}</span>
                  <span className="lp-stream-amount">{item.amount}</span>
                </div>
              ) : (
                <div
                  key={item.name}
                  className="lp-stream-open"
                  style={{ top: index * 26 }}
                >
                  {item.name}
                </div>
              ),
            )}
          </div>
        ))}
      </div>
      <span className="lp-fade lp-stream-fade-top" />
      <span className="lp-fade lp-stream-fade-bottom" />
    </div>
  );
}
