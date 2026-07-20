let clientIdSequence = 0;

export function getNowDate() {
  return new Date();
}

export function createTimestamp(date: Date = getNowDate()) {
  return date.toISOString();
}

export function createClientId(prefix: string) {
  clientIdSequence += 1;
  return `${prefix}-${getNowDate().getTime()}-${clientIdSequence}`;
}

export function formatRelativeTime(iso: string) {
  const timestamp = new Date(iso).getTime();
  const now = Date.now();
  const diffSeconds = Math.round((timestamp - now) / 1000);
  const absoluteSeconds = Math.abs(diffSeconds);

  const divisions: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
  ];

  const formatter = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto",
  });

  for (const [unit, secondsInUnit] of divisions) {
    if (absoluteSeconds >= secondsInUnit) {
      return formatter.format(Math.round(diffSeconds / secondsInUnit), unit);
    }
  }

  return formatter.format(diffSeconds, "second");
}
