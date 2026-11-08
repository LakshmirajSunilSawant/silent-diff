// Demo lead lists, generated deterministically. "After" has reassigned owners,
// status changes, a few new and removed leads, a new column, a renamed column and some whitespace noise.

const FIRST = ['Ava', 'Ben', 'Chloe', 'Dev', 'Elena', 'Farah', 'Gus', 'Hana', 'Ivan', 'Jada', 'Kai', 'Lena', 'Mateo', 'Nia', 'Omar', 'Priya'];
const LAST = ['Okafor', 'Smith', 'Tanaka', 'Rossi', 'Novak', 'Haddad', 'Silva', 'Kim', 'Petrov', 'Brown', 'Nguyen', 'Garcia'];
const CO = ['Acme', 'Globex', 'Initech', 'Umbrella', 'Hooli', 'Stark Ind.', 'Wayne Ent.', 'Soylent', 'Vandelay', 'Wonka'];
const OWNERS = ['Sam', 'Riley', 'Jordan', 'Casey'];
const STATUS = ['New', 'Contacted', 'Qualified', 'Proposal', 'Won', 'Lost'];

function rand(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

interface Lead {
  id: string;
  name: string;
  email: string;
  company: string;
  owner: string;
  status: string;
  value: string;
  zip: string;
}

function makeLeads(n: number): Lead[] {
  const r = rand(42);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  return Array.from({ length: n }, (_, i) => {
    const first = pick(FIRST);
    const last = pick(LAST);
    return {
      id: `L-${String(1001 + i)}`,
      name: `${first} ${last}`,
      email: `${first}.${last}${i}@example.com`.toLowerCase(),
      company: pick(CO),
      owner: pick(OWNERS),
      status: pick(STATUS),
      value: (Math.round(r() * 400) * 125).toLocaleString('en-US', { minimumFractionDigits: 2 }),
      zip: String(Math.floor(r() * 99999)).padStart(5, '0'),
    };
  });
}

const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function sampleFiles(): { before: File; after: File } {
  const before = makeLeads(120);
  const after: (Lead & { phone: string })[] = before.map((l, i) => ({ ...l, phone: `+1 555 01${String(i).padStart(2, '0')}` }));

  // Reassign owners and move statuses along.
  for (const i of [3, 17, 18, 42, 77, 101]) after[i].owner = OWNERS[(OWNERS.indexOf(after[i].owner) + 1) % OWNERS.length];
  for (const i of [5, 17, 60, 88]) after[i].status = 'Won';
  after[33].value = '62,500.00';
  after[51].company += ' '; // trailing space: ignored with "trim whitespace" on
  after[64].email = 'new.address@example.com';
  // Drop three leads and add four.
  for (const i of [90, 25, 9]) after.splice(i, 1);
  const extra = makeLeads(124).slice(120).map((l, k) => ({ ...l, id: `L-${2001 + k}`, phone: '' }));
  after.splice(40, 0, extra[0], extra[1]);
  after.push(extra[2], extra[3]);

  const cols: (keyof Lead)[] = ['id', 'name', 'email', 'company', 'owner', 'status', 'value', 'zip'];
  const bText = [cols.join(','), ...before.map((l) => cols.map((c) => q(l[c])).join(','))].join('\n');
  const aCols = [...cols.slice(0, 3), 'phone' as const, ...cols.slice(3)];
  // "zip" is renamed to "postal_code" in After, so the app suggests treating them as one column.
  const aHeader = aCols.map((c) => (c === 'zip' ? 'postal_code' : c));
  const aText = [aHeader.join(','), ...after.map((l) => aCols.map((c) => q(l[c as keyof typeof l])).join(','))].join('\n');
  return {
    before: new File([bText], 'leads_v1.csv', { type: 'text/csv' }),
    after: new File([aText], 'leads_final.csv', { type: 'text/csv' }),
  };
}
