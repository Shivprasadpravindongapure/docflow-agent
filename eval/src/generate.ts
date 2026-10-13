import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const names = [
  'Aarav Sharma',
  'Anaya Patel',
  'Ishaan Verma',
  'Diya Rao',
  'Kabir Mehta',
  'Myra Nair',
  'Vivaan Joshi',
  'Sara Khan',
  'Arjun Das',
  'Tara Iyer',
  'Reyansh Gupta',
  'Kiara Shah',
  'Aditya Bose',
  'Riya Menon',
  'Dev Malhotra',
  'Ira Kulkarni',
  'Neil Reddy',
  'Mira Thomas',
  'Ayaan Kapoor',
  'Zoya Sinha',
  'Rohan Desai',
  'Meera Pillai',
  'Yash Bhat',
  'Nina George',
  'Om Prakash',
  'Aisha Roy',
  'Kian Fernandes',
  'Pia Chawla',
  'Samar Gill',
  'Leela Krishnan',
  'Dhruv Jain',
  'Tia Dutta',
  'Manav Sethi',
  'Avni Shetty',
  'Ritvik Anand',
  'Nisha Paul',
  'Aarohi Sen',
  'Veer Oberoi',
  'Sana Mirza',
  'Kunal Yadav',
  'Ishita Ghosh',
  'Parth Sood',
  'Navya Menon',
  'Eshan Roy',
  'Amara Dsouza',
  'Rudra Sane',
  'Mahi Bansal',
  'Avi Chatterjee',
  'Sia Narang',
  'Neil Fernandes'
];

const mismatchFields = [
  'name',
  'roll_number',
  'dob',
  'board',
  'year',
  'total',
  'result',
  'name',
  'roll_number',
  'total'
] as const;

type Marksheet = {
  id: string;
  name: string;
  roll_number: string;
  dob: string;
  board: string;
  year: number;
  total: number;
  result: string;
  planted_mismatch: string;
};

const headers = [
  'id',
  'name',
  'roll_number',
  'dob',
  'board',
  'year',
  'total',
  'result',
  'planted_mismatch'
] as const;

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function escapeCsv(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function createMarksheet(index: number): Marksheet {
  const record: Marksheet = {
    id: `DF-2027-${String(index + 1).padStart(4, '0')}`,
    name: names[index],
    roll_number: `SYN27-${String(index + 1).padStart(4, '0')}`,
    dob: `${2005 + (index % 3)}-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 27) + 1).padStart(2, '0')}`,
    board: ['North State Board', 'Central State Board', 'Coastal State Board'][index % 3],
    year: 2024 + (index % 3),
    total: 300 + ((index * 17) % 201),
    result: index % 11 === 0 ? 'PASS WITH DISTINCTION' : 'PASS',
    planted_mismatch: ''
  };

  if (index < mismatchFields.length) {
    const field = mismatchFields[index];
    record.planted_mismatch = field;

    switch (field) {
      case 'name':
        record.name = `Synthetic ${record.name}`;
        break;
      case 'roll_number':
        record.roll_number = `ERR-${record.roll_number}`;
        break;
      case 'dob':
        record.dob = '2000-01-01';
        break;
      case 'board':
        record.board = 'Sample Mismatch Board';
        break;
      case 'year':
        record.year += 1;
        break;
      case 'total':
        record.total = record.total === 500 ? 499 : record.total + 1;
        break;
      case 'result':
        record.result = 'SYNTHETIC REVIEW';
        break;
    }
  }

  return record;
}

function renderSvg(record: Marksheet): string {
  const rows = [
    ['Name', record.name],
    ['Roll number', record.roll_number],
    ['Date of birth', record.dob],
    ['Board', record.board],
    ['Year', String(record.year)],
    ['Total marks', `${record.total} / 500`],
    ['Result', record.result]
  ];
  const rowMarkup = rows
    .map(([label, value], index) => {
      const y = 205 + index * 54;
      return `<text x="90" y="${y}" class="label">${label}</text><text x="340" y="${y}" class="value">${escapeXml(value)}</text>`;
    })
    .join('');

  return `<svg width="1200" height="760" xmlns="http://www.w3.org/2000/svg">
    <rect width="1200" height="760" fill="#f5f7f2"/>
    <rect x="28" y="28" width="1144" height="704" rx="8" fill="#fff" stroke="#254b45" stroke-width="3"/>
    <rect x="28" y="28" width="1144" height="130" fill="#254b45"/>
    <text x="90" y="82" class="title">SYNTHETIC ACADEMIC RECORD</text>
    <text x="90" y="124" class="subtitle">Sample board examination marksheet - ${record.id}</text>
    ${rowMarkup}
    <line x1="90" y1="610" x2="1110" y2="610" stroke="#cbd5cf" stroke-width="2"/>
    <text x="90" y="666" class="footer">FOR SOFTWARE TESTING ONLY - NO REAL STUDENT DATA</text>
    <style>
      .title { font: 700 31px Arial, sans-serif; fill: #ffffff; letter-spacing: 1px; }
      .subtitle { font: 18px Arial, sans-serif; fill: #e4eee9; }
      .label { font: 700 21px Arial, sans-serif; fill: #254b45; }
      .value { font: 22px Arial, sans-serif; fill: #17211e; }
      .footer { font: 700 16px Arial, sans-serif; fill: #63736d; }
    </style>
  </svg>`;
}

export async function generateDataset(outputDirectory = path.resolve(fileURLToPath(new URL('../data', import.meta.url)))) {
  const imagesDirectory = path.join(outputDirectory, 'images');
  await mkdir(imagesDirectory, { recursive: true });

  const records = names.map((_, index) => createMarksheet(index));
  await Promise.all(
    records.map((record) =>
      sharp(Buffer.from(renderSvg(record)))
        .png()
        .toFile(path.join(imagesDirectory, `${record.id}.png`))
    )
  );

  const csv = [
    headers.join(','),
    ...records.map((record) => headers.map((header) => escapeCsv(record[header])).join(','))
  ].join('\n');

  await writeFile(path.join(outputDirectory, 'answer_key.csv'), `${csv}\n`, 'utf8');
  console.log(`Generated ${records.length} synthetic marksheets in ${imagesDirectory}`);
  console.log(`Wrote answer key with ${records.length} rows to ${path.join(outputDirectory, 'answer_key.csv')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generateDataset();
}