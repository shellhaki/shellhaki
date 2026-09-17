// Generates the stats, streak and language SVG cards for the profile README.
// Runs in GitHub Actions so the cards never depend on a rate-limited public service.
//
//   GITHUB_TOKEN=... bun scripts/profile-cards.ts [username] [outDir]

const USER = process.argv[2] ?? "shellhaki";
const OUT = process.argv[3] ?? "dist";
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("GITHUB_TOKEN is required");

const PALETTE = { purple: "#7F00FF", magenta: "#E100FF", cyan: "#00D4FF" };
const FONT = "'Segoe UI', Ubuntu, 'Helvetica Neue', Arial, sans-serif";

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (!res.ok || json.errors || !json.data) {
    throw new Error(`GitHub GraphQL error: ${res.status} ${JSON.stringify(json.errors ?? json)}`);
  }
  return json.data;
}

// ── data ────────────────────────────────────────────────────────────────────

type Repo = {
  stargazerCount: number;
  languages: { edges: { size: number; node: { name: string; color: string | null } }[] };
};

async function fetchRepos(): Promise<Repo[]> {
  const repos: Repo[] = [];
  let cursor: string | null = null;
  do {
    const data: {
      user: { repositories: { nodes: Repo[]; pageInfo: { hasNextPage: boolean; endCursor: string } } };
    } = await gql(
      `query($login: String!, $cursor: String) {
        user(login: $login) {
          repositories(first: 100, after: $cursor, ownerAffiliations: OWNER, isFork: false) {
            nodes {
              stargazerCount
              languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
                edges { size node { name color } }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { login: USER, cursor },
    );
    repos.push(...data.user.repositories.nodes);
    cursor = data.user.repositories.pageInfo.hasNextPage ? data.user.repositories.pageInfo.endCursor : null;
  } while (cursor);
  return repos;
}

type Profile = {
  pullRequests: { totalCount: number };
  issues: { totalCount: number };
  repositoriesContributedTo: { totalCount: number };
  contributionsCollection: { contributionYears: number[] };
};

async function fetchProfile(): Promise<Profile> {
  const data = await gql<{ user: Profile }>(
    `query($login: String!) {
      user(login: $login) {
        pullRequests { totalCount }
        issues { totalCount }
        repositoriesContributedTo(contributionTypes: [COMMIT, PULL_REQUEST, ISSUE, REPOSITORY]) { totalCount }
        contributionsCollection { contributionYears }
      }
    }`,
    { login: USER },
  );
  return data.user;
}

type Year = {
  totalCommitContributions: number;
  restrictedContributionsCount: number;
  contributionCalendar: {
    totalContributions: number;
    weeks: { contributionDays: { date: string; contributionCount: number }[] }[];
  };
};

async function fetchYears(years: number[]): Promise<Year[]> {
  const fields = years
    .map(
      (y) => `y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${y}-12-31T23:59:59Z") {
        totalCommitContributions
        restrictedContributionsCount
        contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
      }`,
    )
    .join("\n");
  const data = await gql<{ user: Record<string, Year> }>(
    `query($login: String!) { user(login: $login) { ${fields} } }`,
    { login: USER },
  );
  return years.map((y) => data.user[`y${y}`]!);
}

// ── maths ───────────────────────────────────────────────────────────────────

type Streak = { length: number; start: string | null; end: string | null };

function streaks(days: { date: string; count: number }[]) {
  const today = new Date().toISOString().slice(0, 10);
  const past = days.filter((d) => d.date <= today).sort((a, b) => a.date.localeCompare(b.date));

  let longest: Streak = { length: 0, start: null, end: null };
  let run: Streak = { length: 0, start: null, end: null };
  for (const d of past) {
    if (d.count > 0) {
      run = { length: run.length + 1, start: run.start ?? d.date, end: d.date };
      if (run.length > longest.length) longest = { ...run };
    } else {
      run = { length: 0, start: null, end: null };
    }
  }

  // Today not having contributions yet shouldn't break the current streak.
  let i = past.length - 1;
  if (i >= 0 && past[i]!.date === today && past[i]!.count === 0) i--;
  let current: Streak = { length: 0, start: null, end: null };
  for (; i >= 0 && past[i]!.count > 0; i--) {
    current = { length: current.length + 1, start: past[i]!.date, end: current.end ?? past[i]!.date };
  }
  return { current, longest };
}

// ── rendering helpers ───────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : n.toLocaleString("en-US"));
const fmtDate = (iso: string | null, withYear = false) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        ...(withYear ? { year: "numeric" } : {}),
        timeZone: "UTC",
      })
    : "";
const range = (s: Streak) => {
  if (!s.start || !s.end) return "No streak yet";
  if (s.start === s.end) return fmtDate(s.start, true);
  const sameYear = s.start.slice(0, 4) === s.end.slice(0, 4);
  return `${fmtDate(s.start, !sameYear)} – ${fmtDate(s.end, true)}`;
};

function card(width: number, height: number, title: string, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">
  <title>${esc(title)}</title>
  <defs>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${PALETTE.purple}"/>
      <stop offset="50%" stop-color="${PALETTE.magenta}"/>
      <stop offset="100%" stop-color="${PALETTE.cyan}"/>
    </linearGradient>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" class="bg-a"/>
      <stop offset="100%" class="bg-b"/>
    </linearGradient>
  </defs>
  <style>
    text { font-family: ${FONT}; }
    .bg-a { stop-color: #140b24; } .bg-b { stop-color: #0b1320; }
    .title { font-size: 18px; font-weight: 700; }
    .label { font-size: 14px; fill: #c9d1d9; }
    .value { font-size: 14px; font-weight: 700; fill: #ffffff; }
    .big { font-size: 28px; font-weight: 700; fill: #ffffff; }
    .muted { font-size: 12px; fill: #8b949e; }
    .track { stroke: #ffffff; stroke-opacity: .08; }
    .divider { stroke: #ffffff; stroke-opacity: .1; }
    .fade { opacity: 0; animation: fade .6s ease-out forwards; }
    .grow { transform-box: fill-box; transform-origin: left; transform: scaleX(0); animation: grow 1s ease-out .2s forwards; }
    @keyframes fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    @keyframes grow { to { transform: scaleX(1); } }
    @media (prefers-color-scheme: light) {
      .bg-a { stop-color: #faf5ff; } .bg-b { stop-color: #f0fbff; }
      .label { fill: #3d444d; } .value, .big { fill: #1f2328; } .muted { fill: #59636e; }
      .track, .divider { stroke: #1f2328; }
    }
  </style>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="14" fill="url(#bg)" stroke="url(#accent)" stroke-opacity=".6"/>
  <text x="25" y="38" class="title fade" fill="url(#accent)">${esc(title)}</text>
${body}
</svg>`;
}

function ring(cx: number, cy: number, r: number, fraction: number, delay: number) {
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0.04, Math.min(1, fraction)));
  return `  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="7" class="track"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#accent)" stroke-width="7" stroke-linecap="round"
    stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${c.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})">
    <animate attributeName="stroke-dashoffset" from="${c.toFixed(2)}" to="${offset.toFixed(2)}" dur="1.2s" begin="${delay}s" fill="freeze" calcMode="spline" keySplines="0.25 0.1 0.25 1"/>
  </circle>`;
}

// ── cards ───────────────────────────────────────────────────────────────────

function statsCard(s: { stars: number; commits: number; prs: number; issues: number; contributedTo: number; total: number }) {
  const rows: [string, number, string][] = [
    ["Total stars earned", s.stars, PALETTE.magenta],
    ["Total commits", s.commits, PALETTE.purple],
    ["Pull requests", s.prs, PALETTE.cyan],
    ["Issues", s.issues, PALETTE.magenta],
    ["Contributed to", s.contributedTo, PALETTE.purple],
  ];
  const body = rows
    .map(
      ([label, value, color], i) => `  <g class="fade" style="animation-delay:${0.15 + i * 0.1}s">
    <circle cx="31" cy="${70 + i * 26}" r="4" fill="${color}"/>
    <text x="45" y="${75 + i * 26}" class="label">${label}</text>
    <text x="265" y="${75 + i * 26}" class="value" text-anchor="end">${fmt(value)}</text>
  </g>`,
    )
    .join("\n");
  return card(
    440,
    210,
    "GitHub Stats",
    `${body}
${ring(355, 112, 50, 1, 0.3)}
  <g class="fade" style="animation-delay:.6s">
    <text x="355" y="115" class="big" text-anchor="middle">${fmt(s.total)}</text>
    <text x="355" y="134" class="muted" text-anchor="middle">contributions</text>
  </g>`,
  );
}

function languagesCard(langs: { name: string; color: string; pct: number }[]) {
  const barW = 390;
  let x = 25;
  const segments = langs
    .map((l) => {
      const w = (l.pct / 100) * barW;
      const seg = `<rect x="${x.toFixed(2)}" y="58" width="${w.toFixed(2)}" height="10" fill="${l.color}"/>`;
      x += w;
      return seg;
    })
    .join("");
  const legend = langs
    .map((l, i) => {
      const lx = i % 2 === 0 ? 25 : 230;
      const ly = 100 + Math.floor(i / 2) * 30;
      return `  <g class="fade" style="animation-delay:${0.3 + i * 0.08}s">
    <circle cx="${lx + 6}" cy="${ly - 5}" r="6" fill="${l.color}"/>
    <text x="${lx + 20}" y="${ly}" class="label">${esc(l.name)}</text>
    <text x="${lx + 185}" y="${ly}" class="muted" text-anchor="end">${l.pct.toFixed(1)}%</text>
  </g>`;
    })
    .join("\n");
  return card(
    440,
    210,
    "Most Used Languages",
    `  <clipPath id="bar"><rect x="25" y="58" width="${barW}" height="10" rx="5"/></clipPath>
  <rect x="25" y="58" width="${barW}" height="10" rx="5" class="track" fill="none"/>
  <g clip-path="url(#bar)"><g class="grow">${segments}</g></g>
${legend}`,
  );
}

function streakCard(s: { total: number; since: string; current: Streak; longest: Streak }) {
  // Side columns: number, label, date range. The middle column puts its number inside a ring.
  const col = (cx: number, value: string, label: string, sub: string, delay: number) => `
  <g class="fade" style="animation-delay:${delay}s">
    <text x="${cx}" y="112" class="big" text-anchor="middle">${value}</text>
    <text x="${cx}" y="142" class="label" text-anchor="middle">${label}</text>
    <text x="${cx}" y="164" class="muted" text-anchor="middle">${sub}</text>
  </g>`;
  return card(
    880,
    220,
    "Contribution Streak",
    `  <line x1="293" y1="62" x2="293" y2="196" class="divider"/>
  <line x1="587" y1="62" x2="587" y2="196" class="divider"/>
${col(146, fmt(s.total), "Total Contributions", `${s.since} – Present`, 0.2)}
${ring(440, 100, 36, Math.min(1, s.current.length / Math.max(1, s.longest.length)), 0.3)}
  <g class="fade" style="animation-delay:.5s">
    <text x="440" y="110" class="big" text-anchor="middle">${s.current.length}</text>
    <text x="440" y="164" class="value" text-anchor="middle" fill="url(#accent)" style="fill:url(#accent)">Current Streak</text>
    <text x="440" y="186" class="muted" text-anchor="middle">${range(s.current)}</text>
  </g>
${col(734, String(s.longest.length), "Longest Streak", range(s.longest), 0.4)}`,
  );
}

// ── main ────────────────────────────────────────────────────────────────────

const [profile, repos] = await Promise.all([fetchProfile(), fetchRepos()]);
const years = profile.contributionsCollection.contributionYears.slice().sort();
const yearData = await fetchYears(years);

const days = yearData.flatMap((y) =>
  y.contributionCalendar.weeks.flatMap((w) => w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount }))),
);
const total = yearData.reduce((sum, y) => sum + y.contributionCalendar.totalContributions, 0);
const commits = yearData.reduce((sum, y) => sum + y.totalCommitContributions + y.restrictedContributionsCount, 0);
const { current, longest } = streaks(days);

const bytes = new Map<string, { size: number; color: string }>();
for (const repo of repos) {
  for (const { size, node } of repo.languages.edges) {
    const entry = bytes.get(node.name) ?? { size: 0, color: node.color ?? "#8b949e" };
    entry.size += size;
    bytes.set(node.name, entry);
  }
}
const langTotal = [...bytes.values()].reduce((sum, l) => sum + l.size, 0) || 1;
const langs = [...bytes.entries()]
  .sort((a, b) => b[1].size - a[1].size)
  .slice(0, 8)
  .map(([name, l]) => ({ name, color: l.color, pct: (l.size / langTotal) * 100 }));

await Promise.all([
  Bun.write(
    `${OUT}/stats.svg`,
    statsCard({
      stars: repos.reduce((sum, r) => sum + r.stargazerCount, 0),
      commits,
      prs: profile.pullRequests.totalCount,
      issues: profile.issues.totalCount,
      contributedTo: profile.repositoriesContributedTo.totalCount,
      total,
    }),
  ),
  Bun.write(`${OUT}/languages.svg`, languagesCard(langs)),
  Bun.write(`${OUT}/streak.svg`, streakCard({ total, since: String(years[0] ?? new Date().getFullYear()), current, longest })),
]);

console.log(
  `wrote ${OUT}/{stats,languages,streak}.svg — ${total} contributions, streak ${current.length}/${longest.length}, ${langs.length} languages`,
);
