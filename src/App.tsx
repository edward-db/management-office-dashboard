import { useMemo, useState, useRef, useEffect } from 'react';
import swireFlag from '../images-5.png';
import Fuse from 'fuse.js';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  ScatterChart as ReScatterChart,
  Scatter,
  LineChart,
  Line,
} from 'recharts';

// ----------------------------
// Hierarchy (display-only)
// ----------------------------
const SECONDARY_TO_TERTIARY: Record<string, string[]> = {
  'F&B': ['Café', 'Restaurant', 'Bakery', 'Grab and Go', 'Food Hall', 'Bar'],
  'Retail and Convenience': ['Banking', 'Beauty', 'Health', 'Fashion (Shopping)', 'Smart Locker'],
  'Third Space': ['Event Space', "Member's Club", 'Co-working spaces'],
  Fitness: ['Golf', 'Gym', 'Movement Studio', 'Yoga Studio', 'Physiotherapy'],
  Healthcare: ['Dental Clinic', 'Medical Clinic', 'Physiotherapy'],
  'Trade Categories': [
    'Banking and Financial Services',
    'Technology Media and Telecoms (TMT)',
    'Insurance',
    'Real Estate and Construction',
    'Fashion/Retail',
    'Media',
    'Professional and Business Services',
    'Manufacturing',
    'Marketing',
    'Biotech/Pharmaceutical/Healthcare Products',
    'Holdings',
    'Government',
    'Sourcing and Trading',
    'Logistics (Airlines/Shipping/Transportation/Couriers)',
    'Legal Services',
    'Hotels/Travel Agency',
  ],
};

const LAND_USE_TAGS = ['Office (Land Use)', 'Retail (Land Use)'] as const;
type LandUse = (typeof LAND_USE_TAGS)[number];

// Build reverse lookups
const SECONDARY_TAGS = Object.keys(SECONDARY_TO_TERTIARY);
const TERTIARY_TO_SECONDARY = Object.entries(SECONDARY_TO_TERTIARY).reduce(
  (acc, [secondary, leaves]) => {
    leaves.forEach((leaf) => {
      acc[leaf] = secondary;
    });
    return acc;
  },
  {} as Record<string, string>
);
const ALL_TERTIARY = Object.values(SECONDARY_TO_TERTIARY).flat();

// Helpers: Fitness/Third Space tag family checks
const FITNESS_TERTIARY = SECONDARY_TO_TERTIARY['Fitness'];
const THIRD_SPACE_TERTIARY = SECONDARY_TO_TERTIARY['Third Space'];
function isFitnessOrThirdSpaceTag(tag: string) {
  return (
    tag === 'Fitness' ||
    tag === 'Third Space' ||
    FITNESS_TERTIARY.includes(tag) ||
    THIRD_SPACE_TERTIARY.includes(tag)
  );
}

// Regions for country filter UI (consistent with country generator)
const REGION_TO_COUNTRIES: Record<string, string[]> = {
  Asia: ['Hong Kong', 'Mainland China', 'Japan', 'Singapore', 'South Korea', 'India'],
  Europe: ['UK', 'France', 'Germany'],
  Americas: ['USA'],
  Oceania: ['Australia'],
};
// Note: keep around for future search/autocomplete in countries
// const ALL_COUNTRIES_FOR_FILTER = Array.from(new Set(Object.values(REGION_TO_COUNTRIES).flat())).sort();

const COLORS = [
  '#0088FE',
  '#00C49F',
  '#FFBB28',
  '#FF8042',
  '#8884D8',
  '#82CA9D',
  '#FFC658',
  '#FF6B6B',
  '#4ECDC4',
  '#45B7D1',
  '#A78BFA',
  '#34D399',
  '#F472B6',
];

function isLandUse(tag: string) {
  return tag === 'Office (Land Use)' || tag === 'Retail (Land Use)';
}
function isPrimary(tag: string) {
  return tag === 'Amenity' || isLandUse(tag);
}
function isSecondary(tag: string) {
  return SECONDARY_TAGS.includes(tag);
}
function isTertiary(tag: string) {
  return ALL_TERTIARY.includes(tag);
}

function tagPath(tag: string, dynamic?: { tertiaryToSecondaryDynamic: Record<string, string> }) {
  if (isLandUse(tag)) return `Land Use → ${tag.replace(' (Land Use)', '')}`;
  if (isSecondary(tag)) return tag;
  if (isTertiary(tag)) return `${TERTIARY_TO_SECONDARY[tag]} → ${tag}`;
  // Try dynamic mapping for new tertiaries
  if (dynamic && dynamic.tertiaryToSecondaryDynamic[tag]) return `${dynamic.tertiaryToSecondaryDynamic[tag]} → ${tag}`;
  return tag;
}

function tagPillClass(tag: string) {
  if (isPrimary(tag)) return 'bg-blue-100 text-blue-800';
  if (isSecondary(tag)) return 'bg-green-100 text-green-800';
  return 'bg-purple-100 text-purple-800';
}

const formatNumber = (n: number) => new Intl.NumberFormat('en-HK').format(Math.round(n || 0));

// ----------------------------
  // Synthetic data generator
// ----------------------------
type Tenant = {
  id: number;
  name: string;
  // Building name/acronym, e.g. OTB, TTP, etc.
  location: string;
  // Country of origin
  country?: string;
  landUse: LandUse;
  tags: string[]; // includes landUse, 'Amenity' if applicable, secondary, tertiary (can include multiple tertiary under Trade Categories)
  floorspace: number;
  rentPerSqFt: number; // monthly
  monthlyRent: number;
  annualRent: number;
  premium: boolean;
  leaseYears: number;
  leaseStart: string;
  leaseEnd: string;
  occupancyRate: number;
  // Optional descriptor such as floor information from spreadsheet
  floor?: string;
  // Canonical identity used for cross-building aggregation
  canonicalName?: string;
  // Retail-only sales (synthetic)
  salesMonthly?: { month: string; sales: number }[];
  salesByYear?: { year: string; sales: number }[];
  // Fitness / Third Space engagement (synthetic)
  membershipsMonthly?: { month: string; members: number }[];
  visitsDaily?: { date: string; visits: number }[];
  visitsMonthly?: { month: string; visits: number }[];
  visitsByYear?: { year: string; visits: number }[];
};

const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const pickOne = <T,>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)];

// Generate a reasonable floor label for synthetic tenants
function generateRandomFloorLabel(landUse: LandUse): string {
  // Slight bias: retail on lower floors, office on higher floors; include some ground floors
  const r = Math.random();
  if (r < 0.08) return 'G/F';
  const floorNum = landUse === 'Retail (Land Use)' ? randInt(1, 6) : randInt(7, 45);
  return `${floorNum}/F`;
}

// Parse and sort helpers for floors
function parseFloorLabelToOrder(label: string): number {
  const s = (label || '').trim().toUpperCase();
  if (!s) return Number.POSITIVE_INFINITY;
  if (s === 'G/F' || s === 'G') return 0;
  const b = s.match(/^B(\d+)\/?F?$/);
  if (b) return -Number(b[1]);
  const n = s.match(/^(\d+)\/?F?$/) || s.match(/^(\d+)\s*\/F$/);
  if (n) return Number(n[1]);
  return Number.POSITIVE_INFINITY;
}
function floorLabelComparator(a: string, b: string) {
  return parseFloorLabelToOrder(a) - parseFloorLabelToOrder(b);
}

// Normalize and extract floor labels from potentially messy strings (e.g., "36/F, 35/F" or "12F; G")
function normalizeFloorLabel(label: string): string | null {
  const s = (label || '').trim().toUpperCase();
  if (!s) return null;
  if (s === 'G' || s === 'GF' || s === 'G/F') return 'G/F';
  const b = s.match(/^B\s*(\d+)\s*\/?F?$/);
  if (b) return `B${Number(b[1])}/F`;
  const n = s.match(/^(\d+)\s*\/?F?$/);
  if (n) return `${Number(n[1])}/F`;
  const n2 = s.match(/^(\d+)\s*\/\s*F$/);
  if (n2) return `${Number(n2[1])}/F`;
  return null; // not a floor label
}

function extractFloorTokens(raw: string): string[] {
  const parts = String(raw || '')
    .split(/[;,]/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const norm = normalizeFloorLabel(p);
    if (norm) out.push(norm);
  }
  return out;
}

function sizeFromLandUse(landUse: LandUse) {
  // Spec:
  // Retail: 500–10,000 sf
  // Office: 5,000–50,000 sf
  return landUse === 'Retail (Land Use)' ? randInt(500, 10000) : randInt(5000, 50000);
}

function rentPerSfFromLandUse(landUse: LandUse, premium: boolean) {
  // Spec:
  // Retail: 60–130 HKD psf (monthly)
  // Office: 40–70 HKD psf (monthly)
  const base =
    landUse === 'Retail (Land Use)' ? randInt(60, 130) : randInt(40, 70);
  return premium ? base * 1.15 : base;
}

function landUseBySecondary(secondary: string): LandUse {
  if (secondary === 'Trade Categories') return 'Office (Land Use)';
  if (secondary === 'F&B' || secondary === 'Retail and Convenience')
    return 'Retail (Land Use)';
  // Fitness / Healthcare / Third Space
  return 'Office (Land Use)';
}

// Country of origin generator with simple weighted distribution
const COUNTRIES = [
  'Hong Kong',
  'Mainland China',
  'USA',
  'UK',
  'Japan',
  'Singapore',
  'Australia',
  'France',
  'Germany',
  'South Korea',
  'India',
] as const;

const COUNTRY_WEIGHTS: Record<(typeof COUNTRIES)[number], number> = {
  'Hong Kong': 0.45,
  'Mainland China': 0.2,
  'USA': 0.1,
  'UK': 0.05,
  'Japan': 0.05,
  'Singapore': 0.05,
  'Australia': 0.03,
  'France': 0.02,
  'Germany': 0.02,
  'South Korea': 0.015,
  'India': 0.015,
};

function pickCountry(): (typeof COUNTRIES)[number] {
  const r = Math.random();
  let acc = 0;
  for (const c of COUNTRIES) {
    acc += COUNTRY_WEIGHTS[c] ?? 0;
    if (r <= acc) return c;
  }
  return COUNTRIES[0];
}

// Category-specific synthetic name generator
function generateTenantNameByCategory(secondary: string, tertiary: string, landUse: LandUse): string {
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)];

  // Retail: curated brand-like names
  const cafe = [
    'Daily Grind', 'Harbour Roastery', 'Bean & Co', 'Copper Mug Café', 'Cuppa House', 'Seaside Coffee', 'Urban Brew Lab', 'Lotus Café', 'Bayview Espresso', 'Metro Beans'
  ];
  const restaurant = [
    'Juniper Kitchen', 'The Willow Bistro', 'Copper & Stone', 'Harbourhouse', 'North & Ivy', 'Atlas Kitchen', 'Pearl & Pine', 'The Lantern Room', 'Orchid Table', 'Skyline Eatery'
  ];
  const bakery = [
    'Crumbs & Crust', 'Flour Room', 'Sugar & Whisk', 'Butter Lane', 'Golden Oven', 'Morning Bun', 'Rye & Rind', 'Sweet Hearth', 'Starlight Bakes', 'Pastry Atelier'
  ];
  const grabAndGo = [
    'QuickBite', 'GoBento', 'Wrap & Roll', 'Noodle Box', 'Grain & Greens', 'City Bites', 'Pocket Pasta', 'Rice & Go', 'Soba Sprint', 'Dash Deli'
  ];
  const foodHall = [
    'The Food Atrium', 'Market Lane Hall', 'The Pantry Hall', 'Gather Food Hall', 'Harbour Eats', 'City Market Hall'
  ];
  const bar = [
    'The Copper Fox', 'Juniper Room', 'The Kingfisher', 'Bar Orion', 'Neon & Tonic', 'The Evening Post', 'Nightjar', 'The Lighthouse Bar', 'Amber & Oak', 'Blue Lantern'
  ];

  // Retail & Convenience
  const bankingRetail = ['Harbour Bank', 'Union Trust Bank', 'Central Savings Bank', 'Metro Finance Bank'];
  const beauty = ['Glow Studio', 'Luxe Nails', 'Bloom Beauty', 'Velvet Salon', 'Rose & Amber'];
  const healthRetail = ['Wellness Mart', 'Herb & Care', 'Vital Health Store', 'Pure Remedy', 'Care+ Pharmacy'];
  const fashion = ['Verve Apparel', 'Elm & Ivy', 'Atlas Outfitters', 'Copper Thread', 'Northshore Clothiers', 'Midnight & Dawn'];
  const locker = ['QuickBox Locker', 'ParcelNow Locker', 'SwiftLocker', 'DropPoint Locker'];

  // Third Space
  const eventSpace = ['The Atrium', 'Harbour Hall', 'The Assembly', 'Skyline Event Space', 'Gallery 8'];
  const membersClub = ['The Exchange Club', 'The Foundry Club', 'The Observatory', 'Club Meridian'];
  const coworking = ['Blueprint Co-works', 'Anchor Co-working', 'Harbour Works', 'Founders Studio'];

  // Fitness
  const golf = ['Urban Golf Lab', 'Harbour Golf Studio', 'Greenline Golf'];
  const gym = ['Pulse Fitness', 'Ironworks Gym', 'Core District', 'Peak Performance Gym'];
  const movement = ['Flow Movement Studio', 'Kinetic Room', 'Motion & Form', 'Movement Lab'];
  const yoga = ['Lotus Yoga Studio', 'Sun & Moon Yoga', 'Prana House', 'Riverstone Yoga'];
  const physio = ['Peak Physio Clinic', 'Harbour Physio', 'MotionCare Physiotherapy'];

  // Healthcare
  const dental = ['Harbour Dental Clinic', 'Central Dental Studio', 'Cedar Dental'];
  const medical = ['Central Medical Centre', 'Harbour Medical', 'Orchid Medical Clinic'];

  // Corporate-style names for Trade Categories and generic office brands
  const corpPrefixes = ['Harbour', 'Zenith', 'Aurora', 'Pinnacle', 'Summit', 'Bridgewater', 'Silverline', 'Northwood', 'BlueRock', 'Everstone', 'Crestpoint', 'Oakridge', 'Stonegate'];
  const corpCore = {
    'Banking and Financial Services': ['Capital', 'Securities', 'Asset Management', 'Advisors', 'Holdings', 'Partners', 'Wealth'],
    'Technology Media and Telecoms (TMT)': ['Technologies', 'Systems', 'Digital', 'Networks', 'Media', 'Labs', 'Solutions'],
    'Insurance': ['Insurance', 'Assurance', 'Risk', 'Underwriters', 'Mutual'],
    'Real Estate and Construction': ['Real Estate', 'Properties', 'Construction', 'Development', 'Builders', 'Holdings'],
    'Fashion/Retail': ['Retail', 'Brands', 'Apparel', 'Trading', 'Group'],
  } as Record<string, string[]>;
  const legalSuffix = () => (Math.random() < 0.7 ? ' Limited' : '');

  const sec = secondary || '';
  const ter = tertiary || '';

  if (sec === 'F&B') {
    if (ter === 'Café') return pick(cafe);
    if (ter === 'Restaurant') return pick(restaurant);
    if (ter === 'Bakery') return pick(bakery);
    if (ter === 'Grab and Go') return pick(grabAndGo);
    if (ter === 'Food Hall') return pick(foodHall);
    if (ter === 'Bar') return pick(bar);
  }
  if (sec === 'Retail and Convenience') {
    if (ter === 'Banking') return pick(bankingRetail);
    if (ter === 'Beauty') return pick(beauty);
    if (ter === 'Health') return pick(healthRetail);
    if (ter === 'Fashion (Shopping)') return pick(fashion);
    if (ter === 'Smart Locker') return pick(locker);
  }
  if (sec === 'Third Space') {
    if (ter === 'Event Space') return pick(eventSpace);
    if (ter === "Member's Club") return pick(membersClub);
    if (ter === 'Co-working spaces') return pick(coworking);
  }
  if (sec === 'Fitness') {
    if (ter === 'Golf') return pick(golf);
    if (ter === 'Gym') return pick(gym);
    if (ter === 'Movement Studio') return pick(movement);
    if (ter === 'Yoga Studio') return pick(yoga);
    if (ter === 'Physiotherapy') return pick(physio);
  }
  if (sec === 'Healthcare') {
    if (ter === 'Dental Clinic') return pick(dental);
    if (ter === 'Medical Clinic') return pick(medical);
  }
  if (sec === 'Trade Categories') {
    const coreList = corpCore[ter] || ['Holdings', 'Group', 'Partners'];
    return `${pick(corpPrefixes)} ${pick(coreList)}${legalSuffix()}`;
  }

  // Generic fallback
  const genericAdj = ['Harbour', 'Central', 'Pacific', 'Orchid', 'Jade', 'Lion Rock', 'Star', 'Pearl', 'Skyline', 'Bayview'];
  const genericNoun = landUse === 'Retail (Land Use)'
    ? ['Market', 'Collective', 'House', 'Boutique', 'Corner', 'Arcade', 'Emporium']
    : ['Group', 'Holdings', 'Studios', 'Works', 'Collective', 'Partners', 'Ventures', 'Labs'];
  return `${pick(genericAdj)} ${pick(genericNoun)}`;
}

  function generateTenants(): Tenant[] {
  const locations = ['OTP', 'TTP', 'PCT', 'BEH', 'OXH', 'LIH', 'DOH', 'DEH', 'CAH', 'OIE'] as const;
  let idCounter = 1;
  let locationCursor = 0;
  const tenants: Tenant[] = [];

  function pushTenant(seed: {
    name: string;
    landUse?: LandUse;
    includeAmenity?: boolean;
    secondary?: string;
    tertiary?: string | string[];
    premium?: boolean;
    floorspace?: number;
    rentPerSqFt?: number;
    location?: (typeof locations)[number];
    country?: string;
  }) {
     const landUse: LandUse =
      seed.landUse ??
      (seed.secondary ? landUseBySecondary(seed.secondary) : pickOne([...LAND_USE_TAGS]));

    const secondary = seed.secondary ? [seed.secondary] : [];

    const tertiaryList = Array.isArray(seed.tertiary)
      ? seed.tertiary
      : seed.tertiary
      ? [seed.tertiary]
      : [];

    const premium = seed.premium ?? Math.random() > 0.6;

    const floorspace = seed.floorspace ?? sizeFromLandUse(landUse);
    const rentPerSqFt = seed.rentPerSqFt ?? rentPerSfFromLandUse(landUse, premium);
    const monthlyRent = Math.round(floorspace * rentPerSqFt);
    const annualRent = monthlyRent * 12;

    const leaseYears = pickOne([3, 5, 7, 10]);
    const leaseStart = String(2019 + randInt(0, 6));
    const leaseEnd = String(Number(leaseStart) + leaseYears);

    const tags: string[] = [landUse];
    if (seed.includeAmenity || (secondary.length && secondary[0] !== 'Trade Categories')) {
      // Amenity for non-Trade Categories groups by default
      tags.push('Amenity');
    }
    tags.push(...secondary);
    tags.push(...tertiaryList);

    const floorLabel = generateRandomFloorLabel(landUse);
    tenants.push({
      id: idCounter++,
      name: seed.name,
      location: seed.location ?? locations[locationCursor++ % locations.length],
      country: seed.country ?? pickCountry(),
      landUse,
      tags,
      floorspace,
      rentPerSqFt,
      monthlyRent,
      annualRent,
      premium,
      leaseYears,
      leaseStart,
      leaseEnd,
      occupancyRate: 85 + Math.random() * 15,
      floor: floorLabel,
    });
  }

  // Required example tenants
  pushTenant({ name: 'Pure Yoga', landUse: 'Office (Land Use)', includeAmenity: true, secondary: 'Fitness', tertiary: 'Yoga Studio', premium: true });
  pushTenant({ name: 'Domain Café', landUse: 'Retail (Land Use)', includeAmenity: true, secondary: 'F&B', tertiary: 'Café', premium: true });
  pushTenant({ name: 'Swire Properties', landUse: 'Office (Land Use)', includeAmenity: false, secondary: 'Trade Categories', tertiary: ['Real Estate and Construction', 'Holdings'], premium: true });
  pushTenant({ name: 'Mr & Mrs Fox', landUse: 'Retail (Land Use)', includeAmenity: true, secondary: 'F&B', tertiary: 'Restaurant' });
  pushTenant({ name: 'The Cakery', landUse: 'Retail (Land Use)', includeAmenity: true, secondary: 'F&B', tertiary: 'Bakery' });
  pushTenant({ name: 'SaladStop!', landUse: 'Retail (Land Use)', includeAmenity: true, secondary: 'F&B', tertiary: 'Grab and Go' });
  pushTenant({ name: 'Tong Chong Kitchen', landUse: 'Retail (Land Use)', includeAmenity: true, secondary: 'F&B', tertiary: 'Food Hall' });
  pushTenant({ name: 'Kaki', landUse: 'Retail (Land Use)', includeAmenity: true, secondary: 'F&B', tertiary: 'Bar' });
  pushTenant({ name: 'Hang Seng ATM', landUse: 'Retail (Land Use)', includeAmenity: true, secondary: 'Retail and Convenience', tertiary: 'Banking' });
  pushTenant({ name: 'Nail Jolly', landUse: 'Retail (Land Use)', includeAmenity: true, secondary: 'Retail and Convenience', tertiary: 'Beauty' });
  pushTenant({ name: 'Mannings Plus', landUse: 'Retail (Land Use)', includeAmenity: true, secondary: 'Retail and Convenience', tertiary: 'Health' });
  pushTenant({ name: 'HULA', landUse: 'Retail (Land Use)', includeAmenity: true, secondary: 'Retail and Convenience', tertiary: 'Fashion (Shopping)' });
  pushTenant({ name: 'Alfred Smart Locker', landUse: 'Retail (Land Use)', includeAmenity: true, secondary: 'Retail and Convenience', tertiary: 'Smart Locker' });
  pushTenant({ name: 'ArtisTree', landUse: 'Office (Land Use)', includeAmenity: true, secondary: 'Third Space', tertiary: 'Event Space' });
  pushTenant({ name: 'The Refinery', landUse: 'Office (Land Use)', includeAmenity: true, secondary: 'Third Space', tertiary: "Member's Club" });
  pushTenant({ name: 'Blueprint', landUse: 'Office (Land Use)', includeAmenity: true, secondary: 'Third Space', tertiary: 'Co-working spaces' });
  pushTenant({ name: 'Hi-Tee Golf', landUse: 'Office (Land Use)', includeAmenity: true, secondary: 'Fitness', tertiary: 'Golf' });
  pushTenant({ name: 'Pure Fitness', landUse: 'Office (Land Use)', includeAmenity: true, secondary: 'Fitness', tertiary: 'Gym', premium: true });
  pushTenant({ name: 'H Kore', landUse: 'Office (Land Use)', includeAmenity: true, secondary: 'Fitness', tertiary: 'Movement Studio' });
  pushTenant({ name: 'Pro Health Sports and Spinal', landUse: 'Office (Land Use)', includeAmenity: true, secondary: 'Fitness', tertiary: 'Physiotherapy' });
  pushTenant({ name: 'Dr Steven Chung Dental', landUse: 'Office (Land Use)', includeAmenity: true, secondary: 'Healthcare', tertiary: 'Dental Clinic' });
  pushTenant({ name: 'Adventist Medical Centre', landUse: 'Office (Land Use)', includeAmenity: true, secondary: 'Healthcare', tertiary: 'Medical Clinic' });

  // Additional random tenants to reach ~100
  while (tenants.length < 100) {
    const secondary = pickOne(SECONDARY_TAGS);
    const tertiary = pickOne(SECONDARY_TO_TERTIARY[secondary]);
    const landUse = landUseBySecondary(secondary);
    const name = generateTenantNameByCategory(secondary, tertiary, landUse);
    pushTenant({
      name,
      landUse,
      includeAmenity: secondary !== 'Trade Categories',
      secondary,
      tertiary,
      premium: Math.random() > 0.65,
    });
  }

  return tenants;
}

function addSyntheticSalesIfMissing(source: Tenant[]): Tenant[] {
  const out: Tenant[] = source.map((t) => ({ ...t }));
  for (const t of out) {
    if (t.landUse !== 'Retail (Land Use)') continue;
    const hasSales = Array.isArray((t as any).salesMonthly) && (t as any).salesMonthly.length;
    if (hasSales) continue;
    const floorspace = t.floorspace || 0;
    const rpsf = t.rentPerSqFt || 0;
    const monthsBack = 24;
    const today = new Date();
    const series: { month: string; sales: number }[] = [];
    const factor = 18 + Math.random() * 8;
    const base = floorspace * rpsf * factor;
    const trend = (Math.random() - 0.5) * 0.08;
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const m = d.getMonth();
      const season = 1 + (m === 11 ? 0.18 : m === 0 ? 0.08 : m >= 5 && m <= 7 ? -0.06 : 0);
      const tcoef = 1 + trend * ((monthsBack - 1 - i) / (monthsBack - 1));
      const noise = 1 + (Math.random() - 0.5) * 0.08;
      const sales = Math.max(0, Math.round(base * season * tcoef * noise));
      series.push({ month: ym, sales });
    }
    const byYear = new Map<string, number>();
    for (const r of series) {
      const y = r.month.slice(0, 4);
      byYear.set(y, (byYear.get(y) || 0) + r.sales);
    }
    (t as any).salesMonthly = series;
    (t as any).salesByYear = Array.from(byYear.entries()).map(([year, sales]) => ({ year, sales }));
  }
  return out;
}

// Add engagement (memberships/visits) to Fitness and Third Space where missing
function addSyntheticEngagementIfMissing(source: Tenant[]): Tenant[] {
  const out: Tenant[] = source.map((t) => ({ ...t }));
  const today = new Date();
  const monthsBack = 24;
  const daysBack = 180; // last 6 months of daily visits

  for (const t of out) {
    const isFitness = t.tags.includes('Fitness');
    const isThirdSpace = t.tags.includes('Third Space');
    if (!isFitness && !isThirdSpace) continue;

    // Memberships monthly
    if (!Array.isArray((t as any).membershipsMonthly) || !(t as any).membershipsMonthly.length) {
      const baseMembers = Math.max(50, Math.round((t.floorspace / 50) * (t.premium ? 1.3 : 1)));
      const growth = (Math.random() - 0.3) * 0.06; // slight positive drift
      const series: { month: string; members: number }[] = [];
      for (let i = monthsBack - 1; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const trend = 1 + growth * ((monthsBack - 1 - i) / (monthsBack - 1));
        const season = 1 + (d.getMonth() === 0 ? -0.04 : d.getMonth() === 8 ? 0.06 : 0); // Jan dip, Sep bump
        const noise = 1 + (Math.random() - 0.5) * 0.05;
        const members = Math.max(20, Math.round(baseMembers * trend * season * noise));
        series.push({ month: ym, members });
      }
      (t as any).membershipsMonthly = series;
    }

    // Visits daily (last ~180 days)
    if (!Array.isArray((t as any).visitsDaily) || !(t as any).visitsDaily.length) {
      const baseVisits = Math.max(5, Math.round(((t as any).membershipsMonthly?.[monthsBack - 1]?.members || 200) * 0.18));
      const series: { date: string; visits: number }[] = [];
      for (let i = daysBack - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const weekday = d.getDay(); // 0 Sun .. 6 Sat
        const weekend = weekday === 0 || weekday === 6;
        const season = 1 + (d.getMonth() === 11 ? 0.05 : 0); // slightly higher in Dec
        const wfactor = weekend ? 0.85 : 1.0; // slightly fewer visits on weekends for office-located gyms
        const noise = 1 + (Math.random() - 0.5) * 0.25;
        const visits = Math.max(0, Math.round(baseVisits * season * wfactor * noise));
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        series.push({ date: ds, visits });
      }
      (t as any).visitsDaily = series;
    }

    // Visits monthly and yearly aggregates
    if (!Array.isArray((t as any).visitsMonthly) || !(t as any).visitsMonthly.length) {
      const byMonth = new Map<string, number>();
      ((t as any).visitsDaily as { date: string; visits: number }[]).forEach((r) => {
        const ym = r.date.slice(0, 7);
        byMonth.set(ym, (byMonth.get(ym) || 0) + r.visits);
      });
      (t as any).visitsMonthly = Array.from(byMonth.entries()).map(([month, visits]) => ({ month, visits }));
    }
    if (!Array.isArray((t as any).visitsByYear) || !(t as any).visitsByYear.length) {
      const byYear = new Map<string, number>();
      ((t as any).visitsMonthly as { month: string; visits: number }[]).forEach((r) => {
        const y = r.month.slice(0, 4);
        byYear.set(y, (byYear.get(y) || 0) + r.visits);
      });
      (t as any).visitsByYear = Array.from(byYear.entries()).map(([year, visits]) => ({ year, visits }));
    }
  }
  return out;
}

// Removed auto-country injection; country now must be provided via CSV/JSON

// ----------------------------
// CSV Export
// ----------------------------
function exportToCsv(filename: string, rows: any[], headers?: string[]) {
  if (!rows.length) return;
  const headerKeys = headers && headers.length ? headers : Object.keys(rows[0]);
  const csv =
    [headerKeys.join(',')]
      .concat(
        rows.map((row) =>
          headerKeys
            .map((h) => {
              const cell = row[h];
              const value =
                cell === null || cell === undefined
                  ? ''
                  : Array.isArray(cell)
                  ? `"${cell.join(' | ').replace(/"/g, '""')}"`
                  : String(cell).includes(',') || String(cell).includes('"') || String(cell).includes('\n')
                  ? `"${String(cell).replace(/"/g, '""')}"`
                  : String(cell);
              return value;
            })
            .join(',')
        )
      )
      .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ----------------------------
// Component
// ----------------------------
type Props = {
  tenantData?: Tenant[];
};

export default function TenantPortfolioDashboard({ tenantData }: Props) {
  // Data
  const baseData = useMemo<Tenant[]>(() => {
    if (Array.isArray(tenantData) && tenantData.length) return tenantData;
    // Prefer baked dataset (demo/master) to avoid stale local overrides
    try {
      const el = document.getElementById('preloaded-tenants-json');
      if (el && el.textContent) {
        const parsed = JSON.parse(el.textContent) as Tenant[];
        if (Array.isArray(parsed) && parsed.length) return addSyntheticEngagementIfMissing(parsed);
      }
    } catch {}
    // Only fall back to localStorage if explicitly set by upload flow
    try {
      const source = localStorage.getItem('tenantDataSource');
      const raw = localStorage.getItem('tenantData');
      if (source === 'uploaded' && raw) {
        const parsed = JSON.parse(raw) as Tenant[];
        if (Array.isArray(parsed) && parsed.length) return addSyntheticEngagementIfMissing(parsed);
      }
    } catch {}
    // Fallback to synthetic with guaranteed sales for retail
    return addSyntheticEngagementIfMissing(addSyntheticSalesIfMissing(generateTenants()));
  }, [tenantData]);

  // Derive dynamic tag dictionary from data so new CSV tags and secondaries are recognized without code changes
  const dynamicTags = useMemo(() => {
    const dynamicTertiarySet = new Set<string>();
    const dynamicSecondarySet = new Set<string>();
    const tertiaryToSecondaryDynamic: Record<string, string> = {};
    for (const t of baseData) {
      const observedCSVSecondary = (t as any)._secondary as string | undefined;
      if (observedCSVSecondary && !SECONDARY_TAGS.includes(observedCSVSecondary)) {
        dynamicSecondarySet.add(observedCSVSecondary);
      }
      const secInTenant = (t.tags || []).find((tag) => SECONDARY_TAGS.includes(tag));
      const secCandidate = secInTenant || observedCSVSecondary;
      for (const tag of t.tags || []) {
        if (!tag || tag === 'Amenity' || isLandUse(tag)) continue;
        if (SECONDARY_TAGS.includes(tag)) continue; // secondary itself
        dynamicTertiarySet.add(tag);
        if (secCandidate && !tertiaryToSecondaryDynamic[tag]) tertiaryToSecondaryDynamic[tag] = secCandidate;
      }
    }
    const availableTags = [
      'Amenity',
      ...LAND_USE_TAGS,
      ...SECONDARY_TAGS,
      ...Array.from(dynamicSecondarySet).sort(),
      ...Array.from(dynamicTertiarySet).sort(),
    ];
    return { availableTags, dynamicTertiarySet, tertiaryToSecondaryDynamic, dynamicSecondarySet };
  }, [baseData]);

  // UI state
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tenantSearch, setTenantSearch] = useState('');
  const [tenantMenuOpen, setTenantMenuOpen] = useState(false);
  const tenantInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedTenantIds, setSelectedTenantIds] = useState<number[]>([]);
  // Building selection: multi-select. Empty = All
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [buildingMenuOpen, setBuildingMenuOpen] = useState(false);
  const [buildingQuery, setBuildingQuery] = useState('');
  const buildingMenuRef = useRef<HTMLDivElement | null>(null);
  // Building stats (total/vacant area per location) for occupancy KPI
  const [buildingStats, setBuildingStats] = useState<Record<string, { totalArea: number; vacantArea: number }>>({});
  // Normalize dataset building codes to stats codes
  const BUILDING_CODE_MAP: Record<string, string> = useMemo(() => ({ OTP: '1TP', TTP: '2TP' }), []);
  useEffect(() => {
    // Load once from public data
    fetch('/data/building_stats.json')
      .then((r) => r.json())
      .then((rows: Array<{ location: string; totalArea: number; vacantArea: number }> | undefined) => {
        if (!Array.isArray(rows)) return;
        const map: Record<string, { totalArea: number; vacantArea: number }> = {};
        for (const r of rows) {
          if (!r || !r.location) continue;
          map[r.location] = {
            totalArea: Number(r.totalArea) || 0,
            vacantArea: Number(r.vacantArea) || 0,
          };
        }
        setBuildingStats(map);
      })
      .catch(() => {});
  }, []);
  // Floor selection: multi-select. Empty = All
  const [selectedFloors, setSelectedFloors] = useState<string[]>([]);
  const [floorMenuOpen, setFloorMenuOpen] = useState(false);
  const [floorQuery, setFloorQuery] = useState('');
  const floorMenuRef = useRef<HTMLDivElement | null>(null);
  // Country selection: multi-select. Empty = All
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  // const [countryMenuOpen, setCountryMenuOpen] = useState(false);
  // const [countryQuery, setCountryQuery] = useState('');
  // const countryMenuRef = useRef<HTMLDivElement | null>(null);
  const availableLocations = useMemo(() => {
    return Array.from(new Set(baseData.map((t) => t.location))).sort();
  }, [baseData]);

  // Per-building floor count (based on max non-negative floor observed)
  const locationToNumFloors = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of baseData) {
      const tokens = extractFloorTokens(t.floor || '');
      for (const tok of tokens) {
        const ord = parseFloorLabelToOrder(tok);
        if (Number.isFinite(ord) && ord >= 0) {
          const prev = m.get(t.location) || 0;
          if (ord > prev) m.set(t.location, ord);
        }
      }
    }
    return m;
  }, [baseData]);

  const filteredLocations = useMemo(() => {
    const q = buildingQuery.trim().toLowerCase();
    if (!q) return availableLocations;
    return availableLocations.filter((l) => l.toLowerCase().includes(q));
  }, [availableLocations, buildingQuery]);

  const availableFloors = useMemo(() => {
    const s = new Set<string>();
    baseData.forEach((t) => {
      const tokens = extractFloorTokens(t.floor || '');
      tokens.forEach((tok) => s.add(tok));
    });
    // Always include Ground Floor option for discovery
    s.add('G/F');
    return Array.from(s).sort(floorLabelComparator);
  }, [baseData]);

  const filteredFloors = useMemo(() => {
    const q = floorQuery.trim().toLowerCase();
    if (!q) return availableFloors;
    return availableFloors.filter((f) => f.toLowerCase().includes(q));
  }, [availableFloors, floorQuery]);

  // const availableCountries = useMemo(() => {
  //   return Array.from(new Set(baseData.map((t) => t.country || 'Unknown'))).sort();
  // }, [baseData]);

  function toggleCountry(country: string) {
    setSelectedCountries((prev) =>
      prev.includes(country) ? prev.filter((c) => c !== country) : [...prev, country]
    );
  }

  function toggleLocation(loc: string) {
    setSelectedLocations((prev) =>
      prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]
    );
  }

  function toggleFloor(floor: string) {
    setSelectedFloors((prev) =>
      prev.includes(floor) ? prev.filter((f) => f !== floor) : [...prev, floor]
    );
  }

  const [rentPeriod, setRentPeriod] = useState<'monthly' | 'annual'>('monthly');

  const [chart, setChart] = useState<'bar' | 'pie' | 'scatter' | 'sales' | 'engagement'>('bar');
  const [chartMode, setChartMode] = useState<'individual' | 'grouped' | 'country' | 'building' | 'floor'>('individual');
  const [metric, setMetric] = useState<'rent' | 'space' | 'count'>('rent');
  const [valueMode, setValueMode] = useState<'absolute' | 'percent'>('absolute');
  const [allocation, setAllocation] = useState<'split' | 'overlap'>('split');
  const [salesMode, setSalesMode] = useState<'level' | 'mom' | 'yoy'>('level');
  const [mainView, setMainView] = useState<'charts' | 'table'>('charts');
  // Engagement view controls (for Fitness / Third Space)
  const [engageMetric, setEngageMetric] = useState<'visits' | 'memberships'>('visits');
  const [engagePeriod, setEngagePeriod] = useState<'daily' | 'monthly' | 'yearly'>('monthly');

  // Export options modal state
  const [exportOpen, setExportOpen] = useState(false);
  const [exportScope, setExportScope] = useState<'filtered' | 'selected'>('filtered');
  // Base (Identity & Location) group and granular toggles
  const [includeBaseGroup, setIncludeBaseGroup] = useState(true);
  const [includeBaseId, setIncludeBaseId] = useState(true);
  const [includeBaseName, setIncludeBaseName] = useState(true);
  const [includeBaseLocation, setIncludeBaseLocation] = useState(true);
  const [includeBaseFloor, setIncludeBaseFloor] = useState(true);
  const [includeBaseCountry, setIncludeBaseCountry] = useState(true);
  const [includeBaseLandUse, setIncludeBaseLandUse] = useState(true);
  // Space group
  const [includeSpaceGroup, setIncludeSpaceGroup] = useState(false);
  const [includeSpaceFloorspace, setIncludeSpaceFloorspace] = useState(false);
  // Rent & Lease group
  const [includeRentGroup, setIncludeRentGroup] = useState(true);
  const [includeRentPerSqFt, setIncludeRentPerSqFt] = useState(true);
  const [includeMonthlyRent, setIncludeMonthlyRent] = useState(false);
  const [includeAnnualRent, setIncludeAnnualRent] = useState(false);
  const [includeOccupancyRate, setIncludeOccupancyRate] = useState(false);
  const [includeLeaseYears, setIncludeLeaseYears] = useState(false);
  const [includeLeaseStart, setIncludeLeaseStart] = useState(false);
  const [includeLeaseEnd, setIncludeLeaseEnd] = useState(false);
  // Tags
  const [includeTagsField, setIncludeTagsField] = useState(true);
  const [includeSalesLatest, setIncludeSalesLatest] = useState(false);
  const [includeSalesLTM, setIncludeSalesLTM] = useState(false);
  const [includeSalesMonthlySeries, setIncludeSalesMonthlySeries] = useState(false);
  const [includeSalesYearly, setIncludeSalesYearly] = useState(false);
  const [includeRentToSalesMonthly, setIncludeRentToSalesMonthly] = useState(false);
  const [includeRentToSalesAnnual, setIncludeRentToSalesAnnual] = useState(false);
  // Export dropdown open states
  const [baseDropdownOpen, setBaseDropdownOpen] = useState(false);
  const [spaceDropdownOpen, setSpaceDropdownOpen] = useState(false);
  const [rentDropdownOpen, setRentDropdownOpen] = useState(false);

  // Determine if current tag selection is exclusively Fitness/Third Space family
  const isEngagementContext = useMemo(() => {
    if (!selectedTags.length) return false;
    return selectedTags.every((t) => isFitnessOrThirdSpaceTag(t));
  }, [selectedTags]);

  // Ensure valid engagement period for memberships (monthly only)
  useEffect(() => {
    if (engageMetric === 'memberships' && engagePeriod !== 'monthly') {
      setEngagePeriod('monthly');
    }
  }, [engageMetric, engagePeriod]);

  // Ensure metric remains valid for the current chartMode
  useEffect(() => {
    if (chartMode === 'individual' && metric === 'count') {
      setMetric('rent');
    }
  }, [chartMode, metric]);

  // Ensure metric remains valid for charts that don't support count
  useEffect(() => {
    if ((chart === 'scatter' || chart === 'sales' || chart === 'engagement') && metric === 'count') {
      setMetric('rent');
    }
  }, [chart, metric]);

  // Auto-switch Sales <-> Engagement based on tag context
  useEffect(() => {
    if (isEngagementContext && chart === 'sales') setChart('engagement');
    if (!isEngagementContext && chart === 'engagement') setChart('sales');
  }, [isEngagementContext, chart]);

  // Count doesn't support percent share; coerce to absolute
  useEffect(() => {
    if (metric === 'count' && valueMode !== 'absolute') {
      setValueMode('absolute');
    }
  }, [metric, valueMode]);

  // Rent-to-Sales helpers
  function computeTenantAnnualSalesLast12Months(tenant: Tenant): number | null {
    if (!Array.isArray((tenant as any).salesMonthly) || !(tenant as any).salesMonthly.length) return null;
    const series = (tenant as any).salesMonthly as { month: string; sales: number }[];
    const last12 = series.slice(-12);
    if (!last12.length) return null;
    return last12.reduce((s, r) => s + (r.sales || 0), 0);
  }
  function computeTenantLatestMonthlySales(tenant: Tenant): number | null {
    if (!Array.isArray((tenant as any).salesMonthly) || !(tenant as any).salesMonthly.length) return null;
    return ((tenant as any).salesMonthly as { month: string; sales: number }[])[(tenant as any).salesMonthly.length - 1]?.sales ?? null;
  }
  function computeRentToSales(tenant: Tenant): { monthlyRatio: number | null; annualRatio: number | null } {
    const latestMonthly = computeTenantLatestMonthlySales(tenant);
    const monthlyRatio = latestMonthly && latestMonthly > 0 ? (tenant.monthlyRent / latestMonthly) * 100 : null;
    const annualSales = computeTenantAnnualSalesLast12Months(tenant);
    const annualRatio = annualSales && annualSales > 0 ? (tenant.annualRent / annualSales) * 100 : null;
    return { monthlyRatio, annualRatio };
  }

  // Tag search/autocomplete
  const [tagQuery, setTagQuery] = useState('');
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const tagInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!tagInputRef.current) return;
      if (!tagInputRef.current.contains(e.target as Node)) {
        setTagMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Close tenant suggestions when clicking outside
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!tenantInputRef.current) return;
      if (!tenantInputRef.current.contains(e.target as Node)) {
        setTenantMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Close building menu when clicking outside
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!buildingMenuRef.current) return;
      if (!buildingMenuRef.current.contains(e.target as Node)) {
        setBuildingMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Close floor menu when clicking outside
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!floorMenuRef.current) return;
      if (!floorMenuRef.current.contains(e.target as Node)) {
        setFloorMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Country pills don't use a dropdown right now

  const filteredTagOptions = useMemo(() => {
    const q = tagQuery.trim().toLowerCase();
    const options = dynamicTags.availableTags.filter((t) => !selectedTags.includes(t));
    if (!q) return options.slice(0, 50);
    return options.filter((t) => tagPath(t, dynamicTags).toLowerCase().includes(q)).slice(0, 50);
  }, [tagQuery, selectedTags, dynamicTags]);

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  // Expandable secondary sections
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() =>
    SECONDARY_TAGS.reduce((acc, s) => {
      acc[s] = false;
      return acc;
    }, {} as Record<string, boolean>)
  );
  function toggleSection(sec: string) {
    setOpenSections((prev) => ({ ...prev, [sec]: !prev[sec] }));
  }

  // Helper: build grouped aggregates for an arbitrary list of tags, honoring allocation and rentPeriod
  function buildGroupsForTags(tagsForGroups: string[]) {
    const groupsInit: Record<string, { space: number; rent: number; count: number }> = {};
    tagsForGroups.forEach((t) => (groupsInit[t] = { space: 0, rent: 0, count: 0 }));
    for (const tenant of nonTagFiltered) {
      const matched = tagsForGroups.filter((tg) => tenant.tags.includes(tg));
      if (matched.length === 0) continue;
      const weight = allocation === 'split' ? 1 / matched.length : 1;
      const rentVal = rentPeriod === 'monthly' ? tenant.monthlyRent : tenant.annualRent;
      for (const tg of matched) {
        const g = groupsInit[tg];
        g.space += tenant.floorspace * weight;
        g.rent += rentVal * weight;
        g.count += weight;
      }
    }
    return tagsForGroups.map((name) => ({ name, ...groupsInit[name] }));
  }

  // Helper: determine which tags to show as groups when grouped view is active
  function computeGroupedDisplayTags(): string[] {
    if (!selectedTags.length) return [];
    if (selectedTags.length === 1) {
      const only = selectedTags[0];
      if (only === 'Amenity') {
        return SECONDARY_TAGS.filter((sec) => sec !== 'Trade Categories');
      }
      if (only === 'Office (Land Use)') {
        return SECONDARY_TAGS.filter((sec) => sec !== 'F&B' && sec !== 'Retail and Convenience');
      }
      if (only === 'Retail (Land Use)') {
        return ['F&B', 'Retail and Convenience'];
      }
      if (isSecondary(only)) {
        const staticList = SECONDARY_TO_TERTIARY[only] || [];
        const dynamicList = Array.from(dynamicTags.dynamicTertiarySet).filter((t) => dynamicTags.tertiaryToSecondaryDynamic[t] === only);
        return Array.from(new Set([...staticList, ...dynamicList])).sort();
      }
      // Handle dynamically observed secondaries from CSV not present in static mapping
      if (dynamicTags.dynamicSecondarySet && dynamicTags.dynamicSecondarySet.has(only)) {
        const dynamicList = Array.from(dynamicTags.dynamicTertiarySet).filter((t) => dynamicTags.tertiaryToSecondaryDynamic[t] === only);
        return dynamicList.sort();
      }
    }
    return selectedTags;
  }

  // Non-tag filters
  // Build a Fuse.js index for fuzzy tenant search
  const tenantFuse = useMemo(() => {
    return new Fuse(baseData, {
      keys: [
        { name: 'name', weight: 0.7 },
        { name: 'location', weight: 0.2 },
        { name: 'tags', weight: 0.1 },
      ],
      threshold: 0.3,
      ignoreLocation: true,
      includeScore: true,
    });
  }, [baseData]);

  const tenantSearchMatches = useMemo(() => {
    const q = tenantSearch.trim();
    if (!q) return [] as Tenant[];
    const res = tenantFuse.search(q, { limit: 200 });
    return res.map((r) => r.item);
  }, [tenantFuse, tenantSearch]);

  const tenantSuggestionList = useMemo(() => {
    const q = tenantSearch.trim();
    if (!q) return [] as Tenant[];
    const res = tenantFuse.search(q, { limit: 8 });
    return res.map((r) => r.item);
  }, [tenantFuse, tenantSearch]);

  const selectedTenants = useMemo(() => {
    if (!selectedTenantIds.length) return [] as Tenant[];
    const setIds = new Set(selectedTenantIds);
    return baseData.filter((t) => setIds.has(t.id));
  }, [baseData, selectedTenantIds]);

  function toggleTenantSelection(tenant: Tenant) {
    setSelectedTenantIds((prev) =>
      prev.includes(tenant.id) ? prev.filter((id) => id !== tenant.id) : [...prev, tenant.id]
    );
  }

  const nonTagFiltered = useMemo(() => {
    return baseData.filter((t) => {
      if (selectedTenantIds.length > 0 && !selectedTenantIds.includes(t.id)) return false;
      if (tenantSearch.trim()) {
        // If we have fuzzy matches, restrict to those; if no matches, fall back to substring to allow discovery
        if (tenantSearchMatches.length) {
          const allowed = tenantSearchMatches;
          if (!allowed.some((itm) => itm.id === t.id)) return false;
        } else if (!t.name.toLowerCase().includes(tenantSearch.toLowerCase())) {
          return false;
        }
      }
      if (selectedLocations.length > 0 && !selectedLocations.includes(t.location)) return false;
      if (selectedFloors.length > 0) {
        const tokens = extractFloorTokens(t.floor || '');
        if (tokens.length === 0) return false;
        if (!tokens.some((f) => selectedFloors.includes(f))) return false;
      }
      if (selectedCountries.length > 0) {
        const c = t.country || 'Unknown';
        if (!selectedCountries.includes(c)) return false;
      }
      return true;
    });
  }, [baseData, selectedTenantIds, tenantSearch, tenantSearchMatches, selectedLocations, selectedFloors, selectedCountries]);

  // Final filtered tenants (OR logic on tags)
  const filteredTenants = useMemo(() => {
    if (!selectedTags.length) return nonTagFiltered;
    return nonTagFiltered.filter((t) => selectedTags.some((tag) => t.tags.includes(tag)));
  }, [nonTagFiltered, selectedTags]);

  // KPIs + market compare
  const kpis = useMemo(() => {
    const tenants = filteredTenants;
    const totalTenants = tenants.length;
    const totalSpace = tenants.reduce((s, t) => s + t.floorspace, 0);
    const totalMonthly = tenants.reduce((s, t) => s + t.monthlyRent, 0);
    const totalAnnual = tenants.reduce((s, t) => s + t.annualRent, 0);
    const avgRentPerSqFt = totalSpace ? totalMonthly / totalSpace : 0;
    const avgOcc = totalTenants
      ? tenants.reduce((s, t) => s + t.occupancyRate, 0) / totalTenants
      : 0;

    // Portfolio/building occupancy based on buildingStats and current building selection
    const locationsForOcc = (selectedLocations.length > 0 ? selectedLocations : availableLocations) || [];
    const occTotals = locationsForOcc.reduce(
      (acc, loc) => {
        const key = BUILDING_CODE_MAP[loc] ?? loc;
        const bs = buildingStats[key];
        if (bs) {
          acc.total += bs.totalArea || 0;
          acc.vacant += bs.vacantArea || 0;
        }
        return acc;
      },
      { total: 0, vacant: 0 }
    );
    const portfolioOccPct = occTotals.total ? ((occTotals.total - occTotals.vacant) / occTotals.total) * 100 : 0;

    // Market benchmark by land use (psf, monthly)
    const marketOffice = 55;
    const marketRetail = 95;
    const officeSpace = tenants
      .filter((t) => t.landUse === 'Office (Land Use)')
      .reduce((s, t) => s + t.floorspace, 0);
    const retailSpace = tenants
      .filter((t) => t.landUse === 'Retail (Land Use)')
      .reduce((s, t) => s + t.floorspace, 0);
    const totalSpaceForWeight = officeSpace + retailSpace || 1;
    const weightedMarket =
      (officeSpace / totalSpaceForWeight) * marketOffice +
      (retailSpace / totalSpaceForWeight) * marketRetail;

    const vsMarketDelta = avgRentPerSqFt - weightedMarket; // positive = above market

    return {
      totalTenants,
      totalSpace,
      totalRent: rentPeriod === 'monthly' ? totalMonthly : totalAnnual,
      avgRentPerSqFt,
      avgOcc,
      weightedMarket,
      vsMarketDelta,
      portfolioOccPct,
    };
  }, [filteredTenants, rentPeriod, selectedLocations, availableLocations, buildingStats]);

  // Comparison groups (for grouped view or summary)
  const selectedTagGroups = useMemo(() => {
    if (!selectedTags.length) return [] as { name: string; count: number; space: number; rent: number; avgRpsf: number }[];
    const buckets: Record<string, { count: number; space: number; rent: number; rpsfSum: number; weight: number }> = {};
    selectedTags.forEach((t) => (buckets[t] = { count: 0, space: 0, rent: 0, rpsfSum: 0, weight: 0 }));

    for (const tenant of nonTagFiltered) {
      const matched = selectedTags.filter((tag) => tenant.tags.includes(tag));
      if (matched.length === 0) continue;
      const w = allocation === 'split' ? 1 / matched.length : 1;
      const rentVal = rentPeriod === 'monthly' ? tenant.monthlyRent : tenant.annualRent;
      matched.forEach((tag) => {
        const b = buckets[tag];
        b.count += allocation === 'split' ? w : 1;
        b.space += tenant.floorspace * w;
        b.rent += rentVal * w;
        b.rpsfSum += tenant.rentPerSqFt * w;
        b.weight += w;
      });
    }

    return selectedTags.map((tag) => {
      const b = buckets[tag];
      return {
        name: tag,
        count: b.count,
        space: b.space,
        rent: b.rent,
        avgRpsf: b.weight ? b.rpsfSum / b.weight : 0,
      };
    });
  }, [selectedTags, nonTagFiltered, rentPeriod, allocation]);

  // Chart datasets
  const individualBarData = useMemo(() => {
    // When Location = All, aggregate same brand across buildings using canonicalName if present
    const source = filteredTenants;
    const aggregated: Record<string, { name: string; landUse: LandUse; tags: string[]; value: number }> = {};
    const useAggregation = selectedLocations.length !== 1; // aggregate unless exactly one building selected

    const addRow = (key: string, t: Tenant) => {
      const addVal = metric === 'space' ? t.floorspace : rentPeriod === 'monthly' ? t.monthlyRent : t.annualRent;
      if (!aggregated[key]) aggregated[key] = { name: t.name, landUse: t.landUse, tags: t.tags, value: 0 };
      aggregated[key].value += addVal;
    };

    if (useAggregation) {
      for (const t of source) {
        const key = t.canonicalName ? t.canonicalName : t.name.toUpperCase();
        addRow(key, t);
      }
      const list = Object.values(aggregated);
      list.sort((a, b) => b.value - a.value);
      return list.slice(0, 30);
    }

    // Building-specific view: show per-row (already per-building from dataset)
    const list = source.map((t) => ({
      name: t.name,
      value: metric === 'space' ? t.floorspace : rentPeriod === 'monthly' ? t.monthlyRent : t.annualRent,
      landUse: t.landUse,
      tags: t.tags,
    }));
    list.sort((a, b) => b.value - a.value);
    return list.slice(0, 30);
  }, [filteredTenants, metric, rentPeriod, selectedLocations]);

  const groupedBarData = useMemo(() => {
    // Group by selected tags if any; else by Land Use
    const groups: { name: string; value: number }[] = [];
    if (selectedTags.length) {
      const tagsForGroups = computeGroupedDisplayTags();
      const agg = buildGroupsForTags(tagsForGroups);
      agg.forEach((g) => {
        const v = metric === 'space' ? g.space : metric === 'rent' ? g.rent : g.count;
        groups.push({ name: g.name, value: v });
      });
    } else {
      const luBuckets: Record<string, number> = { Office: 0, Retail: 0 };
      nonTagFiltered.forEach((t) => {
        let add: number;
        if (metric === 'space') add = t.floorspace;
        else if (metric === 'rent') add = rentPeriod === 'monthly' ? t.monthlyRent : t.annualRent;
        else add = 1;
        if (t.landUse === 'Office (Land Use)') luBuckets.Office += add;
        else luBuckets.Retail += add;
      });
      groups.push({ name: 'Office', value: luBuckets.Office });
      groups.push({ name: 'Retail', value: luBuckets.Retail });
    }
    if (valueMode === 'percent') {
      const total = groups.reduce((s, g) => s + g.value, 0) || 1;
      return groups.map((g) => ({ name: g.name, value: (g.value / total) * 100 }));
    }
    return groups;
  }, [selectedTags, nonTagFiltered, metric, rentPeriod, valueMode]);

  // Country aggregation for bar/pie
  const countryGroupedData = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const t of filteredTenants) {
      const key = t.country || 'Unknown';
      let add: number;
      if (metric === 'space') add = t.floorspace;
      else if (metric === 'rent') add = rentPeriod === 'monthly' ? t.monthlyRent : t.annualRent;
      else add = 1;
      buckets.set(key, (buckets.get(key) || 0) + add);
    }
    const arr = Array.from(buckets.entries()).map(([name, value]) => ({ name, value }));
    // Sort descending; show top N and group others into "Other" if many
    arr.sort((a, b) => b.value - a.value);
    const MAX = 12;
    if (arr.length > MAX) {
      const head = arr.slice(0, MAX - 1);
      const tailSum = arr.slice(MAX - 1).reduce((s, it) => s + it.value, 0);
      head.push({ name: 'Other', value: tailSum });
      if (valueMode === 'percent') {
        const total = head.reduce((s, g) => s + g.value, 0) || 1;
        return head.map((g) => ({ name: g.name, value: (g.value / total) * 100 }));
      }
      return head;
    }
    if (valueMode === 'percent') {
      const total = arr.reduce((s, g) => s + g.value, 0) || 1;
      return arr.map((g) => ({ name: g.name, value: (g.value / total) * 100 }));
    }
    return arr;
  }, [filteredTenants, metric, rentPeriod, valueMode]);

  // Building aggregation for bar/pie
  const buildingGroupedData = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const t of filteredTenants) {
      const key = t.location || 'Unknown';
      let add: number;
      if (metric === 'space') add = t.floorspace;
      else if (metric === 'rent') add = rentPeriod === 'monthly' ? t.monthlyRent : t.annualRent;
      else add = 1;
      buckets.set(key, (buckets.get(key) || 0) + add);
    }
    const arr = Array.from(buckets.entries()).map(([name, value]) => ({ name, value }));
    arr.sort((a, b) => b.value - a.value);
    const MAX = 12;
    if (arr.length > MAX) {
      const head = arr.slice(0, MAX - 1);
      const tailSum = arr.slice(MAX - 1).reduce((s, it) => s + it.value, 0);
      head.push({ name: 'Other', value: tailSum });
      if (valueMode === 'percent') {
        const total = head.reduce((s, g) => s + g.value, 0) || 1;
        return head.map((g) => ({ name: g.name, value: (g.value / total) * 100 }));
      }
      return head;
    }
    if (valueMode === 'percent') {
      const total = arr.reduce((s, g) => s + g.value, 0) || 1;
      return arr.map((g) => ({ name: g.name, value: (g.value / total) * 100 }));
    }
    return arr;
  }, [filteredTenants, metric, rentPeriod, valueMode]);

  // Floor aggregation for bar/pie
  const floorGroupedData = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const t of filteredTenants) {
      const tokens = extractFloorTokens(t.floor || '');
      const keys = tokens.length ? tokens : ['Unknown'];
      let add: number;
      if (metric === 'space') add = t.floorspace;
      else if (metric === 'rent') add = rentPeriod === 'monthly' ? t.monthlyRent : t.annualRent;
      else add = 1;
      for (const key of keys) {
        buckets.set(key, (buckets.get(key) || 0) + add);
      }
    }
    const arr = Array.from(buckets.entries()).map(([name, value]) => ({ name, value }));
    // Use existing floor label comparator for ordering if available
    arr.sort((a, b) => floorLabelComparator(a.name, b.name));
    if (valueMode === 'percent') {
      const total = arr.reduce((s, g) => s + g.value, 0) || 1;
      return arr.map((g) => ({ name: g.name, value: (g.value / total) * 100 }));
    }
    return arr;
  }, [filteredTenants, metric, rentPeriod, valueMode]);

  const pieData = useMemo(() => {
    // Individual tenants pie: share of top tenants
    if (chartMode === 'individual') {
      const useAggregation = selectedLocations.length !== 1;
      const map: Record<string, { name: string; raw: number }> = {};
      for (const t of filteredTenants) {
        const key = useAggregation && t.canonicalName ? t.canonicalName : `${t.id}`;
        const name = useAggregation && t.canonicalName ? (t.name || t.canonicalName) : t.name;
        const add = metric === 'space' ? t.floorspace : (rentPeriod === 'monthly' ? t.monthlyRent : t.annualRent);
        if (!map[key]) map[key] = { name, raw: 0 };
        map[key].raw += add;
      }
      let arr = Object.values(map);
      arr.sort((a, b) => b.raw - a.raw);
      arr = arr.slice(0, 20);
      const total = arr.reduce((s, d) => s + d.raw, 0) || 1;
      return arr.map((d) => (
        valueMode === 'percent' ? { name: d.name, value: (d.raw / total) * 100 } : { name: d.name, value: d.raw }
      ));
    }

    // Grouped/tag pies
    if (selectedTags.length) {
      const tagsForGroups = computeGroupedDisplayTags();
      const agg = buildGroupsForTags(tagsForGroups);
      const arr = agg.map((g) => ({ name: g.name, raw: metric === 'space' ? g.space : g.rent }));
      const total = arr.reduce((s, d) => s + d.raw, 0) || 1;
      return arr.map((d) =>
        valueMode === 'percent'
          ? { name: d.name, value: (d.raw / total) * 100 }
          : { name: d.name, value: d.raw }
      );
    }
    // Default: by Land Use (rent only)
    const buckets: Record<string, number> = { Office: 0, Retail: 0 };
    filteredTenants.forEach((t) => {
      const add = metric === 'space' ? t.floorspace : (rentPeriod === 'monthly' ? t.monthlyRent : t.annualRent);
      if (t.landUse === 'Office (Land Use)') buckets.Office += add;
      else buckets.Retail += add;
    });
    const arr = [
      { name: 'Office', raw: buckets.Office },
      { name: 'Retail', raw: buckets.Retail },
    ];
    const total = arr.reduce((s, d) => s + d.raw, 0) || 1;
    return arr.map((d) =>
      valueMode === 'percent'
        ? { name: d.name, value: (d.raw / total) * 100 }
        : { name: d.name, value: d.raw }
    );
  }, [chartMode, selectedTags, filteredTenants, metric, rentPeriod, valueMode, selectedLocations]);

  const scatterData = useMemo(() => {
    return filteredTenants.map((t) => {
      // Color by first matching selected tag if present; else by land use
      let fill = t.landUse === 'Office (Land Use)' ? '#0088FE' : '#00C49F';
      if (selectedTags.length) {
        const idx = selectedTags.findIndex((tag) => t.tags.includes(tag));
        if (idx >= 0) fill = COLORS[idx % COLORS.length];
      }
      return {
        x: t.floorspace,
        y: rentPeriod === 'monthly' ? t.monthlyRent : t.annualRent,
        z: t.rentPerSqFt,
        name: t.name,
        fill,
      };
    });
  }, [filteredTenants, rentPeriod, selectedTags]);

  // Build sales chart data for retail tenants
  const salesChart = useMemo(() => {
    const candidates = selectedTenants.length ? selectedTenants : filteredTenants;
    const retail = candidates.filter((t) => t.landUse === 'Retail (Land Use)' && Array.isArray(t.salesMonthly) && t.salesMonthly.length);
    if (!retail.length) return { rows: [] as any[], keys: [] as string[] };

    // Helper: get yearly sales map per tenant
    function getYearSalesMap(t: Tenant): Map<string, number> {
      if (Array.isArray((t as any).salesByYear) && (t as any).salesByYear.length) {
        return new Map<string, number>(((t as any).salesByYear as { year: string; sales: number }[]).map((r) => [r.year, r.sales] as const));
      }
      const m = new Map<string, number>();
      t.salesMonthly!.forEach((r: { month: string; sales: number }) => {
        const y = r.month.slice(0, 4);
        m.set(y, (m.get(y) || 0) + r.sales);
      });
      return m;
    }

    // Build time axis by mode
    if (salesMode === 'yoy') {
      const allYears = Array.from(new Set(retail.flatMap((t) => Array.from(getYearSalesMap(t).keys())))).sort();
      const years = allYears.slice(1); // YoY needs previous year
      const rows: any[] = years.map((y) => ({ period: y }));

      // Individual vs Grouped
      if (chartMode === 'grouped') {
        const groups = selectedTags.length ? computeGroupedDisplayTags() : ['Retail'];
        const keys: string[] = [];
        groups.forEach((g) => {
          keys.push(g);
          const members = retail.filter((t) => (selectedTags.length ? t.tags.includes(g) : true));
          years.forEach((y, i) => {
            const prev = String(Number(y) - 1);
            let sumCurr = 0;
            let sumPrev = 0;
            members.forEach((t) => {
              const ym = getYearSalesMap(t);
              sumCurr += ym.get(y) || 0;
              sumPrev += ym.get(prev) || 0;
            });
            const val = sumPrev > 0 ? ((sumCurr - sumPrev) / sumPrev) * 100 : null;
            rows[i][g] = val;
          });
        });
        return { rows, keys };
      } else {
        const keys = retail.map((t) => `${t.name} #${t.id}`);
        retail.forEach((t) => {
          const seriesKey = `${t.name} #${t.id}`;
          const ym = getYearSalesMap(t);
          years.forEach((y, i) => {
            const prev = String(Number(y) - 1);
            const curr = ym.get(y) ?? null;
            const ly = ym.get(prev) ?? null;
            const val = curr != null && ly != null && ly > 0 ? ((curr - ly) / ly) * 100 : null;
            rows[i][seriesKey] = val;
          });
        });
        return { rows, keys };
      }
    }

    // Monthly Level / MoM
    const allMonths = Array.from(new Set(retail.flatMap((t) => t.salesMonthly!.map((r: { month: string; sales: number }) => r.month)))).sort();
    const monthIndex = new Map<string, number>(allMonths.map((m, i) => [m, i] as const));
    const months = salesMode === 'mom' ? allMonths.slice(1) : allMonths;
    const rows: any[] = months.map((m) => ({ period: m }));

    if (chartMode === 'grouped') {
      const groups = selectedTags.length ? computeGroupedDisplayTags() : ['Retail'];
      const keys: string[] = [];
      groups.forEach((g) => {
        keys.push(g);
        const members = retail.filter((t) => (selectedTags.length ? t.tags.includes(g) : true));
        months.forEach((m, i) => {
          const perTenantValues: number[] = [];
          members.forEach((t) => {
            const map = new Map<string, number>(t.salesMonthly!.map((r: { month: string; sales: number }) => [r.month, r.sales] as const));
            const curr = map.get(m) ?? null;
            if (salesMode === 'mom') {
              const idx = monthIndex.get(m) ?? -1;
              const prevMonth = idx > 0 ? allMonths[idx - 1] : undefined;
              const prevVal = prevMonth ? map.get(prevMonth) ?? null : null;
              if (curr != null && prevVal != null && prevVal > 0) perTenantValues.push(((curr - prevVal) / prevVal) * 100);
            } else {
              if (curr != null) perTenantValues.push(curr);
            }
          });
          if (perTenantValues.length) rows[i][g] = perTenantValues.reduce((a, b) => a + b, 0) / perTenantValues.length; else rows[i][g] = null;
        });
      });
      return { rows, keys };
    }

    // Individual monthly
    const keys: string[] = [];
    retail.forEach((t) => {
      const seriesKey = `${t.name} #${t.id}`;
      keys.push(seriesKey);
      const map = new Map<string, number>(t.salesMonthly!.map((r: { month: string; sales: number }) => [r.month, r.sales] as const));
      months.forEach((m, i) => {
        const curr = map.get(m) ?? null;
        let val: number | null = curr;
        if (salesMode === 'mom') {
          const idx = monthIndex.get(m) ?? -1;
          const prevMonth = idx > 0 ? allMonths[idx - 1] : undefined;
          const prevVal = prevMonth ? map.get(prevMonth) ?? null : null;
          if (curr != null && prevVal != null && prevVal > 0) val = ((curr - prevVal) / prevVal) * 100; else val = null;
        }
        rows[i][seriesKey] = val;
      });
    });
    return { rows, keys };
  }, [filteredTenants, selectedTenants, salesMode, chartMode, selectedTags]);

  // Build engagement chart data for Fitness / Third Space (visits/memberships)
  const engagementChart = useMemo(() => {
    const candidates = selectedTenants.length ? selectedTenants : filteredTenants;
    const relevant = candidates.filter((t) => (t.tags.includes('Fitness') || t.tags.includes('Third Space')));
    if (!relevant.length) return { rows: [] as any[], keys: [] as string[] };

    if (engageMetric === 'memberships') {
      // monthly members only
      const allMonths = Array.from(new Set(relevant.flatMap((t) => ((t as any).membershipsMonthly || []).map((r: any) => r.month)))).sort();
      const rows = allMonths.map((m) => ({ period: m } as any));
      if (chartMode === 'grouped') {
        const groups = selectedTags.length ? computeGroupedDisplayTags() : ['Fitness/Third Space'];
        const keys: string[] = [];
        groups.forEach((g) => {
          keys.push(g);
          const members = relevant.filter((t) => (selectedTags.length ? t.tags.includes(g) : true));
          allMonths.forEach((m, i) => {
            const perTenantValues: number[] = [];
            members.forEach((t) => {
              const map = new Map<string, number>(((t as any).membershipsMonthly || []).map((r: any) => [r.month, r.members] as const));
              const curr = map.get(m);
              if (curr != null) perTenantValues.push(curr);
            });
            rows[i][g] = perTenantValues.length ? perTenantValues.reduce((a, b) => a + b, 0) : null;
          });
        });
        return { rows, keys };
      } else {
        const keys: string[] = [];
        relevant.forEach((t) => {
          const seriesKey = `${t.name} #${t.id}`;
          keys.push(seriesKey);
          const map = new Map<string, number>(((t as any).membershipsMonthly || []).map((r: any) => [r.month, r.members] as const));
          allMonths.forEach((m, i) => {
            rows[i][seriesKey] = map.get(m) ?? null;
          });
        });
        return { rows, keys };
      }
    }

    // visits
    if (engagePeriod === 'yearly') {
      const allYears = Array.from(new Set(relevant.flatMap((t) => ((t as any).visitsByYear || []).map((r: any) => r.year)))).sort();
      const rows = allYears.map((y) => ({ period: y } as any));
      if (chartMode === 'grouped') {
        const groups = selectedTags.length ? computeGroupedDisplayTags() : ['Fitness/Third Space'];
        const keys: string[] = [];
        groups.forEach((g) => {
          keys.push(g);
          const members = relevant.filter((t) => (selectedTags.length ? t.tags.includes(g) : true));
          allYears.forEach((y, i) => {
            let sum = 0;
            members.forEach((t) => {
              const map = new Map<string, number>(((t as any).visitsByYear || []).map((r: any) => [r.year, r.visits] as const));
              sum += map.get(y) || 0;
            });
            rows[i][g] = sum || null;
          });
        });
        return { rows, keys };
      } else {
        const keys: string[] = [];
        relevant.forEach((t) => {
          const seriesKey = `${t.name} #${t.id}`;
          keys.push(seriesKey);
          const map = new Map<string, number>(((t as any).visitsByYear || []).map((r: any) => [r.year, r.visits] as const));
          allYears.forEach((y, i) => {
            rows[i][seriesKey] = map.get(y) ?? null;
          });
        });
        return { rows, keys };
      }
    }

    if (engagePeriod === 'monthly') {
      const allMonths = Array.from(new Set(relevant.flatMap((t) => ((t as any).visitsMonthly || []).map((r: any) => r.month)))).sort();
      const rows = allMonths.map((m) => ({ period: m } as any));
      if (chartMode === 'grouped') {
        const groups = selectedTags.length ? computeGroupedDisplayTags() : ['Fitness/Third Space'];
        const keys: string[] = [];
        groups.forEach((g) => {
          keys.push(g);
          const members = relevant.filter((t) => (selectedTags.length ? t.tags.includes(g) : true));
          allMonths.forEach((m, i) => {
            let sum = 0;
            members.forEach((t) => {
              const map = new Map<string, number>(((t as any).visitsMonthly || []).map((r: any) => [r.month, r.visits] as const));
              sum += map.get(m) || 0;
            });
            rows[i][g] = sum || null;
          });
        });
        return { rows, keys };
      } else {
        const keys: string[] = [];
        relevant.forEach((t) => {
          const seriesKey = `${t.name} #${t.id}`;
          keys.push(seriesKey);
          const map = new Map<string, number>(((t as any).visitsMonthly || []).map((r: any) => [r.month, r.visits] as const));
          allMonths.forEach((m, i) => {
            rows[i][seriesKey] = map.get(m) ?? null;
          });
        });
        return { rows, keys };
      }
    }

    // daily
    const allDays = Array.from(new Set(relevant.flatMap((t) => ((t as any).visitsDaily || []).map((r: any) => r.date)))).sort();
    const rows = allDays.map((d) => ({ period: d } as any));
    if (chartMode === 'grouped') {
      const groups = selectedTags.length ? computeGroupedDisplayTags() : ['Fitness/Third Space'];
      const keys: string[] = [];
      groups.forEach((g) => {
        keys.push(g);
        const members = relevant.filter((t) => (selectedTags.length ? t.tags.includes(g) : true));
        allDays.forEach((d, i) => {
          let sum = 0;
          members.forEach((t) => {
            const map = new Map<string, number>(((t as any).visitsDaily || []).map((r: any) => [r.date, r.visits] as const));
            sum += map.get(d) || 0;
          });
          rows[i][g] = sum || null;
        });
      });
      return { rows, keys };
    } else {
      const keys: string[] = [];
      relevant.forEach((t) => {
        const seriesKey = `${t.name} #${t.id}`;
        keys.push(seriesKey);
        const map = new Map<string, number>(((t as any).visitsDaily || []).map((r: any) => [r.date, r.visits] as const));
        allDays.forEach((d, i) => {
          rows[i][seriesKey] = map.get(d) ?? null;
        });
      });
      return { rows, keys };
    }
  }, [filteredTenants, selectedTenants, selectedTags, chartMode, engageMetric, engagePeriod]);

  // Legend colors for selected tags
  // Note: previously used for a legend; kept around if needed in future feature work
  // const tagToColor = useMemo(() => {
  //   const map: Record<string, string> = {};
  //   selectedTags.forEach((t, i) => {
  //     map[t] = COLORS[i % COLORS.length];
  //   });
  //   return map;
  // }, [selectedTags]);

  // Build and export CSV with options
  function handleConfirmExportCsv() {
    const candidates = exportScope === 'selected' && selectedTenants.length > 0 ? selectedTenants : filteredTenants;
    if (candidates.length === 0) {
      setExportOpen(false);
      return;
    }

    // Build dynamic headers in stable order
    const headers: string[] = [];
    if (includeBaseGroup) {
      if (includeBaseId) headers.push('id');
      if (includeBaseName) headers.push('name');
      if (includeBaseLocation) headers.push('location');
      if (includeBaseFloor) headers.push('floor');
      if (includeBaseCountry) headers.push('country');
      if (includeBaseLandUse) headers.push('landUse');
    }
    if (includeSpaceGroup) {
      if (includeSpaceFloorspace) headers.push('floorspace');
    }
    if (includeRentGroup) {
      if (includeRentPerSqFt) headers.push('rentPerSqFt');
      if (includeMonthlyRent) headers.push('monthlyRent');
      if (includeAnnualRent) headers.push('annualRent');
      if (includeOccupancyRate) headers.push('occupancyRate');
      if (includeLeaseYears) headers.push('leaseYears');
      if (includeLeaseStart) headers.push('leaseStart');
      if (includeLeaseEnd) headers.push('leaseEnd');
    }
    if (includeTagsField) {
      headers.push('tags');
    }

    // Sales header unions
    const monthlyMonths: string[] = [];
    const yearlyYears: string[] = [];
    if (includeSalesMonthlySeries) {
      const mset = new Set<string>();
      candidates.forEach((t) => {
        const series = (t as any).salesMonthly as { month: string; sales: number }[] | undefined;
        if (Array.isArray(series)) series.forEach((r) => mset.add(r.month));
      });
      Array.from(mset).sort().forEach((m) => monthlyMonths.push(m));
      monthlyMonths.forEach((m) => headers.push(`Sales ${m}`));
    }
    if (includeSalesYearly) {
      const yset = new Set<string>();
      candidates.forEach((t) => {
        const byYear = (t as any).salesByYear as { year: string; sales: number }[] | undefined;
        if (Array.isArray(byYear)) byYear.forEach((r) => yset.add(r.year));
        const series = (t as any).salesMonthly as { month: string; sales: number }[] | undefined;
        if (!Array.isArray(byYear) && Array.isArray(series)) {
          series.forEach((r) => yset.add(r.month.slice(0, 4)));
        }
      });
      Array.from(yset).sort().forEach((y) => yearlyYears.push(y));
      yearlyYears.forEach((y) => headers.push(`Sales ${y}`));
    }
    if (includeSalesLatest) headers.push('Latest Monthly Sales');
    if (includeSalesLTM) headers.push('Sales LTM (12m)');
    if (includeRentToSalesMonthly) headers.push('Rent-to-Sales Monthly %');
    if (includeRentToSalesAnnual) headers.push('Rent-to-Sales Annual %');

    // Build rows
    const rows = candidates.map((t) => {
      const row: Record<string, any> = {};
      if (includeBaseGroup) {
        if (includeBaseId) row.id = t.id;
        if (includeBaseName) row.name = t.name;
        if (includeBaseLocation) row.location = t.location;
        if (includeBaseFloor) row.floor = t.floor || '';
        if (includeBaseCountry) row.country = t.country || '';
        if (includeBaseLandUse) row.landUse = t.landUse.replace(' (Land Use)', '');
      }
      if (includeSpaceGroup) {
        if (includeSpaceFloorspace) row.floorspace = t.floorspace;
      }
      if (includeRentGroup) {
        if (includeRentPerSqFt) row.rentPerSqFt = t.rentPerSqFt.toFixed(2);
        if (includeMonthlyRent) row.monthlyRent = t.monthlyRent;
        if (includeAnnualRent) row.annualRent = t.annualRent;
        if (includeOccupancyRate) row.occupancyRate = t.occupancyRate.toFixed(1);
        if (includeLeaseYears) row.leaseYears = t.leaseYears;
        if (includeLeaseStart) row.leaseStart = t.leaseStart;
        if (includeLeaseEnd) row.leaseEnd = t.leaseEnd;
      }
      if (includeTagsField) {
        row.tags = t.tags;
      }
      if (includeSalesMonthlySeries && monthlyMonths.length) {
        const map = new Map<string, number>();
        const series = (t as any).salesMonthly as { month: string; sales: number }[] | undefined;
        if (Array.isArray(series)) series.forEach((r) => map.set(r.month, r.sales));
        monthlyMonths.forEach((m) => {
          const key = `Sales ${m}`;
          row[key] = map.get(m) ?? '';
        });
      }
      if (includeSalesYearly && yearlyYears.length) {
        const ymap = new Map<string, number>();
        const byYear = (t as any).salesByYear as { year: string; sales: number }[] | undefined;
        if (Array.isArray(byYear)) byYear.forEach((r) => ymap.set(r.year, r.sales));
        else {
          const series = (t as any).salesMonthly as { month: string; sales: number }[] | undefined;
          if (Array.isArray(series)) {
            series.forEach((r) => {
              const y = r.month.slice(0, 4);
              ymap.set(y, (ymap.get(y) || 0) + r.sales);
            });
          }
        }
        yearlyYears.forEach((y) => {
          const key = `Sales ${y}`;
          row[key] = ymap.get(y) ?? '';
        });
      }
      if (includeSalesLatest) {
        const latest = computeTenantLatestMonthlySales(t);
        row['Latest Monthly Sales'] = latest ?? '';
      }
      if (includeSalesLTM) {
        const ltm = computeTenantAnnualSalesLast12Months(t);
        row['Sales LTM (12m)'] = ltm ?? '';
      }
      if (includeRentToSalesMonthly || includeRentToSalesAnnual) {
        const ratio = computeRentToSales(t);
        if (includeRentToSalesMonthly) row['Rent-to-Sales Monthly %'] = ratio.monthlyRatio ? ratio.monthlyRatio.toFixed(2) : '';
        if (includeRentToSalesAnnual) row['Rent-to-Sales Annual %'] = ratio.annualRatio ? ratio.annualRatio.toFixed(2) : '';
      }
      return row;
    });

    exportToCsv('tenants_export.csv', rows, headers);
    setExportOpen(false);
  }

  

  // Tenant modal
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);

  // Swire brand banner visibility
  const [showSwireBanner, setShowSwireBanner] = useState<boolean>(() => {
    try {
      const params = new URL(window.location.href).searchParams;
      const param = params.get('banner') || params.get('brand');
      if (param) {
        const on = ['1', 'true', 'on', 'yes'].includes(param.toLowerCase());
        localStorage.setItem('swireBanner', on ? '1' : '0');
        return on;
      }
      const saved = localStorage.getItem('swireBanner');
      if (saved === '0') return false;
      if (saved === '1') return true;
      const envDefault = (import.meta.env as any)?.VITE_SHOW_SWIRE_BANNER;
      if (envDefault !== undefined) {
        const v = String(envDefault).toLowerCase();
        return v === '1' || v === 'true' || v === 'on' || v === 'yes';
      }
      return true;
    } catch {
      return true;
    }
  });
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && e.altKey && key === 's') {
        setShowSwireBanner((prev) => {
          const next = !prev;
          try {
            localStorage.setItem('swireBanner', next ? '1' : '0');
          } catch {}
          return next;
        });
        e.preventDefault();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function handleSwireBannerClick(e: React.MouseEvent) {
    if (e.altKey) {
      try { localStorage.setItem('swireBanner', '0'); } catch {}
      setShowSwireBanner(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {showSwireBanner && (
        <div className="bg-slate-900 text-white -mx-6 -mt-6 mb-6 px-6 py-4 shadow">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-4 select-none" onClick={handleSwireBannerClick} title="Alt-click to hide banner">
              <img
                src={swireFlag}
                alt="Swire flag"
                className="h-5 md:h-6 w-auto"
              />
              <div className="hidden sm:flex items-center gap-4">
                <span className="h-6 w-px bg-white/20" />
                <h1 className="text-lg md:text-2xl font-semibold tracking-tight">Management Office Dashboard</h1>
              </div>
            </div>
            <button
              onClick={() => setExportOpen(true)}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500"
            >
              Export CSV
            </button>
          </div>
        </div>
      )}
      <div className="max-w-7xl mx-auto">
        {/* Header removed; content consolidated into top bar */}

        {/* Rent period toggle moved to visualization toolbar below */}
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm p-4">
            <div className="text-xs text-gray-600">Tenants</div>
            <div className="text-2xl font-bold">{kpis.totalTenants}</div>
            <div className="text-xs text-gray-400">of {baseData.length} total</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <div className="text-xs text-gray-600">Total Space</div>
            <div className="text-2xl font-bold">{formatNumber(kpis.totalSpace)} ft²</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <div className="text-xs text-gray-600">
              Total Rent ({rentPeriod === 'monthly' ? 'Monthly' : 'Annual'})
            </div>
            <div className="text-2xl font-bold">HKD {formatNumber(kpis.totalRent)}</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <div className="text-xs text-gray-600">Avg Rent/ft² (monthly)</div>
            <div className="text-2xl font-bold">HKD {kpis.avgRentPerSqFt.toFixed(2)}</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <div className="text-xs text-gray-600 flex items-center justify-between gap-2">
              <span>Occupancy</span>
              <span
                className="inline-flex items-center rounded-full bg-gray-100 text-gray-700 px-2 py-0.5"
                title={selectedLocations.length ? selectedLocations.join(', ') : 'All buildings'}
              >
                {selectedLocations.length === 0
                  ? 'All buildings'
                  : selectedLocations.length === 1
                  ? selectedLocations[0]
                  : `${selectedLocations[0]} + ${selectedLocations.length - 1} more`}
              </span>
            </div>
            <div className="text-2xl font-bold">{kpis.portfolioOccPct.toFixed(1)}%</div>
          </div>

        </div>

        {/* Visualization toolbar and two-column layout */}
        <div className="flex items-center justify-between mb-4">
          <div className="inline-flex rounded-lg overflow-hidden border">
            <button onClick={() => setMainView('charts')} className={`px-4 py-2 ${mainView === 'charts' ? 'bg-slate-900 text-white' : 'bg-white text-gray-800'} hover:bg-slate-50`}>Charts</button>
            <button onClick={() => setMainView('table')} className={`px-4 py-2 ${mainView === 'table' ? 'bg-slate-900 text-white' : 'bg-white text-gray-800'} hover:bg-slate-50`}>Table</button>
          </div>
          <div className="inline-flex rounded overflow-hidden border">
            <button
              onClick={() => setRentPeriod('monthly')}
              className={`px-3 py-2 text-sm ${rentPeriod === 'monthly' ? 'bg-blue-600 text-white' : 'bg-white text-gray-800'} hover:bg-blue-50`}
            >
              Monthly
            </button>
            <button
              onClick={() => setRentPeriod('annual')}
              className={`px-3 py-2 text-sm ${rentPeriod === 'annual' ? 'bg-blue-600 text-white' : 'bg-white text-gray-800'} hover:bg-blue-50`}
            >
              Annual
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
          {/* Sidebar: Filters & Controls */}
          <div className="lg:col-span-4 lg:sticky lg:top-6 self-start max-h-[calc(100vh-3rem)] overflow-auto">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-xl font-semibold mb-4">Filters & Controls</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-1 gap-4 mb-4">
                <div className="relative" ref={tenantInputRef}>
                  <input
                    value={tenantSearch}
                    onChange={(e) => {
                      setTenantSearch(e.target.value);
                      setTenantMenuOpen(true);
                    }}
                    onFocus={() => setTenantMenuOpen(true)}
                    placeholder="Search tenants..."
                    className="px-3 py-2 border rounded-lg w-full"
                    autoComplete="off"
                  />
                  {tenantMenuOpen && tenantSuggestionList.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full max-h-64 overflow-auto bg-white border rounded-lg shadow">
                      {tenantSuggestionList.map((t) => (
                        <button
                          key={t.id}
                          className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between"
                          onClick={() => {
                            toggleTenantSelection(t);
                            setTenantSearch('');
                            setTenantMenuOpen(false);
                          }}
                        >
                          <span className="text-sm text-gray-900 flex items-center gap-2">
                            <span className={`inline-block h-3 w-3 rounded-full border ${selectedTenantIds.includes(t.id) ? 'bg-emerald-500 border-emerald-600' : 'bg-white border-gray-300'}`} />
                            {t.name}
                          </span>
                          <span className="ml-2 text-xs text-gray-500">{t.location}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedTenants.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {selectedTenants.map((t) => (
                        <span key={`sel-${t.id}`} className="px-2 py-1 rounded text-xs bg-emerald-100 text-emerald-800">
                          {t.name}
                          <button className="ml-2 text-emerald-700" onClick={() => toggleTenantSelection(t)}>×</button>
                        </span>
                      ))}
                      <button className="text-xs text-red-600" onClick={() => setSelectedTenantIds([])}>Clear tenants</button>
                    </div>
                  )}
                </div>
                {/* Location / Floor split pill */}
                <div className="relative">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-600">Location / Floor</span>
                  </div>
                  <div className="inline-flex w-full rounded-lg border">
                    {/* Buildings half */}
                    <div className="relative flex-1" ref={buildingMenuRef}>
                      <button
                        className="w-full px-3 py-2 text-left flex items-center justify-between"
                        onClick={() => setBuildingMenuOpen((o) => !o)}
                      >
                        <span className="text-sm text-gray-900">
                          {selectedLocations.length === 0 ? 'All buildings' : `${selectedLocations.length} selected`}
                        </span>
                        <span className="text-gray-500">{buildingMenuOpen ? '▲' : '▼'}</span>
                      </button>
                      {buildingMenuOpen && (
                        <div className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow max-h-64 overflow-auto">
                          <div className="p-2 border-b flex items-center gap-2">
                            <input
                              value={buildingQuery}
                              onChange={(e) => setBuildingQuery(e.target.value)}
                              placeholder="Search buildings..."
                              className="px-2 py-1 border rounded w-full"
                            />
                            <div className="ml-2 flex gap-2">
                              <button
                                className="text-xs text-blue-600"
                                onClick={() => {
                                  setSelectedLocations(availableLocations);
                                }}
                                title="Select all buildings"
                              >
                                Select all
                              </button>
                              <button
                                className="text-xs text-blue-600"
                                onClick={() => {
                                  setSelectedLocations([]);
                                }}
                                title="Clear building selection (show all)"
                              >
                                Clear
                              </button>
                            </div>
                          </div>
                          <div className="p-2">
                            {filteredLocations.map((loc) => (
                              <label key={`loc-${loc}`} className="flex items-center gap-2 text-sm py-1">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4"
                                  checked={selectedLocations.includes(loc)}
                                  onChange={() => toggleLocation(loc)}
                                />
                                <span>
                                  {loc}
                                  {(() => {
                                    const nf = locationToNumFloors.get(loc) || 0;
                                    return nf ? ` (${nf}F)` : '';
                                  })()}
                                </span>
                              </label>
                            ))}
                            {filteredLocations.length === 0 && (
                              <div className="text-xs text-gray-500 py-1">No buildings found</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="w-px bg-gray-200" />
                    {/* Floors half */}
                    <div className="relative flex-1" ref={floorMenuRef}>
                      <button
                        className="w-full px-3 py-2 text-left flex items-center justify-between"
                        onClick={() => setFloorMenuOpen((o) => !o)}
                      >
                        <span className="text-sm text-gray-900">
                          {selectedFloors.length === 0 ? 'All floors' : `${selectedFloors.length} selected`}
                        </span>
                        <span className="text-gray-500">{floorMenuOpen ? '▲' : '▼'}</span>
                      </button>
                      {floorMenuOpen && (
                        <div className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow max-h-64 overflow-auto">
                          <div className="p-2 border-b flex items-center gap-2">
                            <input
                              value={floorQuery}
                              onChange={(e) => setFloorQuery(e.target.value)}
                              placeholder="Search floors (e.g., G/F, 1/F)"
                              className="px-2 py-1 border rounded w-full"
                            />
                            <div className="ml-2 flex gap-2">
                              <button
                                className="text-xs text-blue-600"
                                onClick={() => {
                                  setSelectedFloors(availableFloors);
                                }}
                                title="Select all floors"
                              >
                                Select all
                              </button>
                              <button
                                className="text-xs text-blue-600"
                                onClick={() => {
                                  setSelectedFloors([]);
                                }}
                                title="Clear floor selection (show all)"
                              >
                                Clear
                              </button>
                            </div>
                          </div>
                          <div className="p-2">
                            {filteredFloors.map((f) => (
                              <label key={`floor-${f}`} className="flex items-center gap-2 text-sm py-1">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4"
                                  checked={selectedFloors.includes(f)}
                                  onChange={() => toggleFloor(f)}
                                />
                                <span>{f}</span>
                              </label>
                            ))}
                            {filteredFloors.length === 0 && (
                              <div className="text-xs text-gray-500 py-1">No floors found</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 mb-4">
                {/* Tag autocomplete */}
                <div className="relative" ref={tagInputRef}>
                  <input
                    value={tagQuery}
                    onChange={(e) => {
                      setTagQuery(e.target.value);
                      setTagMenuOpen(true);
                    }}
                    placeholder="Search tags (e.g., F&B → Café)"
                    className="px-3 py-2 border rounded-lg w-full"
                    onFocus={() => setTagMenuOpen(true)}
                  />
                  {tagMenuOpen && (
                    <div className="absolute z-10 mt-1 w-full max-h-64 overflow-auto bg-white border rounded-lg shadow">
                      {filteredTagOptions.length ? (
                        filteredTagOptions.map((t) => (
                          <button
                            key={t}
                            onClick={() => {
                              toggleTag(t);
                              setTagQuery('');
                              setTagMenuOpen(false);
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-gray-50"
                          >
                            <span className="text-sm">{tagPath(t, dynamicTags)}</span>
                            <span className={`ml-2 text-xs px-2 py-0.5 rounded ${tagPillClass(t)}`}>
                              {isPrimary(t) ? 'Primary' : isSecondary(t) ? 'Secondary' : 'Tertiary'}
                            </span>
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-sm text-gray-500">No tags found</div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-28 text-sm text-gray-600">Selected</span>
                  <div className="flex flex-wrap gap-2">
                    {selectedTags.map((t) => (
                      <span key={t} className={`px-2 py-1 rounded text-xs ${tagPillClass(t)}`}>
                        {t}
                        <button className="ml-2 text-gray-600" onClick={() => toggleTag(t)}>×</button>
                      </span>
                    ))}
                    {selectedTags.length > 0 && (
                      <button className="text-sm text-red-600" onClick={() => setSelectedTags([])}>
                        Clear all
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Tag sections */}
              <div className="grid grid-cols-1 lg:grid-cols-1 gap-4">
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="font-semibold mb-2">Primary Tags</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => toggleTag('Amenity')}
                      className={`px-3 py-1.5 rounded-full text-sm ${selectedTags.includes('Amenity') ? 'bg-black text-white' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
                    >
                      Amenity
                    </button>
                    {LAND_USE_TAGS.map((t) => (
                      <button
                        key={t}
                        onClick={() => toggleTag(t)}
                        className={`px-3 py-1.5 rounded-full text-sm ${selectedTags.includes(t) ? 'bg-black text-white' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
                      >
                        {t.replace(' (Land Use)', '')}
                      </button>
                    ))}
                  </div>
                  {selectedTags.some((t) => t === 'Office (Land Use)' || t === 'Retail (Land Use)' || t === 'Amenity') && (
                    <p className="mt-2 text-xs text-gray-600">Tip: In Grouped by Tag, selecting a primary tag will expand to its relevant secondary/tertiary tags.</p>
                  )}
                </div>

                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="font-semibold mb-2">Secondary & Tertiary Tags</div>
                  <div className="grid grid-cols-1 gap-3">
                    {SECONDARY_TAGS.map((sec) => (
                      <div key={sec} className={`border rounded-lg ${sec === 'Trade Categories' ? 'bg-blue-50 border-blue-200' : 'bg-white'}`}>
                        <button
                          onClick={() => toggleSection(sec)}
                          className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50"
                        >
                          <span className={`font-medium ${sec === 'Trade Categories' ? 'text-blue-800' : 'text-gray-800'}`}>{sec}{sec === 'Trade Categories' ? ' (Office)' : ''}</span>
                          <span className="text-gray-500">{openSections[sec] ? '−' : '+'}</span>
                        </button>
                        {openSections[sec] && (
                          <div className="px-3 pb-3">
                            <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Secondary</div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => toggleTag(sec)}
                                className={`px-3 py-1.5 rounded-full text-sm font-medium ${selectedTags.includes(sec) ? (sec === 'Trade Categories' ? 'bg-blue-700 text-white' : 'bg-black text-white') : (sec === 'Trade Categories' ? 'bg-blue-100 text-blue-800 hover:bg-blue-200' : 'bg-gray-200 text-gray-800 hover:bg-gray-300')}`}
                              >
                                {sec}
                              </button>
                            </div>
                            <div className="mt-3 pt-3 border-t border-gray-100">
                              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Tertiary</div>
                              <div className="flex flex-wrap gap-2">
                                {SECONDARY_TO_TERTIARY[sec].map((leaf) => (
                                  <button
                                    key={leaf}
                                    onClick={() => toggleTag(leaf)}
                                    className={`px-3 py-1.5 rounded-full text-sm ${selectedTags.includes(leaf)
                                      ? (sec === 'Trade Categories' ? 'bg-blue-600 text-white' : 'bg-indigo-600 text-white')
                                      : (sec === 'Trade Categories'
                                        ? 'bg-white text-blue-800 hover:bg-blue-50 border border-blue-300'
                                        : 'bg-white text-gray-800 hover:bg-gray-50 border border-gray-300')}`}
                                  >
                                    {leaf}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Country filter (by region) */}
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold">Countries</div>
                    <button
                      className="text-xs text-blue-600"
                      onClick={() => setSelectedCountries([])}
                      title="Clear country selection (show all)"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="text-xs text-gray-600 mb-2">Select one or more countries to filter tenants. Grouped by region for discovery.</div>
                  <div className="grid grid-cols-1 gap-3">
                    {Object.entries(REGION_TO_COUNTRIES).map(([region, list]) => (
                      <div key={`reg-${region}`} className="border rounded-lg bg-white">
                        <div className="w-full flex items-center justify-between px-3 py-2">
                          <span className="font-medium text-gray-800">{region}</span>
                        </div>
                        <div className="px-3 pb-3">
                          <div className="flex flex-wrap gap-2">
                            {list.map((c) => (
                              <button
                                key={c}
                                onClick={() => toggleCountry(c)}
                                className={`px-3 py-1.5 rounded-full text-sm ${selectedCountries.includes(c) ? 'bg-black text-white' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
                              >
                                {c}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {selectedCountries.length > 0 && (
                    <div className="mt-2 text-xs text-gray-600">{selectedCountries.length} country{selectedCountries.length > 1 ? 'ies' : ''} selected</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Main content: Charts or Table */}
          <div className="lg:col-span-8">
            {mainView === 'charts' ? (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <div className="sticky top-0 bg-white z-10 pb-2 mb-4 flex items-center justify-between flex-wrap gap-2">
                  <h3 className="text-lg font-semibold">Visualisations</h3>
                  <div className="flex gap-2 items-center flex-wrap">
                    <div className="flex gap-2">
                      <button onClick={() => setChart('bar')} className={`px-3 py-1 rounded ${chart === 'bar' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>Bar</button>
                      <button onClick={() => setChart('pie')} className={`px-3 py-1 rounded ${chart === 'pie' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>Pie</button>
                      <button onClick={() => setChart('scatter')} className={`px-3 py-1 rounded ${chart === 'scatter' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>Scatter</button>
                      <button onClick={() => setChart(isEngagementContext ? 'engagement' : 'sales')} className={`px-3 py-1 rounded ${(chart === 'sales' || chart === 'engagement') ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>{isEngagementContext ? 'Engagement' : 'Sales'}</button>
                    </div>
                    <div className="h-6 w-px bg-gray-300 mx-2" />
                  <div className="flex gap-2 items-center">
                      {/* Primary views */}
                      <div className="inline-flex rounded overflow-hidden border">
                        <button onClick={() => setChartMode('individual')} className={`px-3 py-1 ${chartMode === 'individual' ? 'bg-emerald-600 text-white' : 'bg-gray-200'}`}>Individual Tenants</button>
                        <button onClick={() => setChartMode('grouped')} className={`px-3 py-1 ${chartMode === 'grouped' ? 'bg-emerald-600 text-white' : 'bg-gray-200'}`}>Grouped by Tag</button>
                      </div>
                      {/* Secondary views dropdown */}
                      <div className="relative">
                        <details className="group">
                          <summary className="list-none px-3 py-1 bg-gray-100 rounded border cursor-pointer flex items-center gap-2">
                            <span className="text-sm">More views</span>
                            <span className="text-gray-500 group-open:rotate-180 transition-transform">▼</span>
                          </summary>
                          <div className="absolute z-10 mt-1 w-44 bg-white border rounded shadow">
                            <button onClick={() => setChartMode('country')} className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${chartMode === 'country' ? 'bg-emerald-50 text-emerald-700' : ''}`}>By Country</button>
                            <button onClick={() => setChartMode('building')} className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${chartMode === 'building' ? 'bg-emerald-50 text-emerald-700' : ''}`}>By Location</button>
                            <button onClick={() => setChartMode('floor')} className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${chartMode === 'floor' ? 'bg-emerald-50 text-emerald-700' : ''}`}>By Floor</button>
                          </div>
                        </details>
                      </div>
                    </div>
                    <div className="h-6 w-px bg-gray-300 mx-2" />
                    {chart !== 'sales' && chart !== 'engagement' ? (
                      <>
                        <div className="flex gap-2">
                          <button onClick={() => setMetric('space')} className={`px-3 py-1 rounded ${metric === 'space' ? 'bg-purple-600 text-white' : 'bg-gray-200'}`}>Space</button>
                          <button onClick={() => setMetric('rent')} className={`px-3 py-1 rounded ${metric === 'rent' ? 'bg-purple-600 text-white' : 'bg-gray-200'}`}>Rent</button>
                          <button onClick={() => setMetric('count')} className={`px-3 py-1 rounded ${metric === 'count' ? 'bg-purple-600 text-white' : 'bg-gray-200'} ${chartMode === 'individual' || chart === 'scatter' ? 'opacity-50 cursor-not-allowed' : ''}`} disabled={chartMode === 'individual' || chart === 'scatter'}>
                            Count
                          </button>
                        </div>
                        <div className="h-6 w-px bg-gray-300 mx-2" />
                        <div className="flex gap-2">
                          <button onClick={() => setValueMode('absolute')} className={`px-3 py-1 rounded ${valueMode === 'absolute' ? 'bg-slate-800 text-white' : 'bg-gray-200'}`}>Absolute</button>
                          <button onClick={() => setValueMode('percent')} className={`px-3 py-1 rounded ${valueMode === 'percent' ? 'bg-slate-800 text-white' : 'bg-gray-200'}`} disabled={chartMode === 'individual' || metric === 'count'}>
                            % Share
                          </button>
                          {selectedTags.length > 0 && (
                            <div className="flex items-center gap-2 ml-2">
                              <span className="text-xs text-gray-600">Duplicates</span>
                              <button onClick={() => setAllocation('split')} className={`px-2 py-1 rounded text-xs ${allocation === 'split' ? 'bg-amber-600 text-white' : 'bg-gray-200'}`} title="Split shared tenants across selected tags equally">Split</button>
                              <button onClick={() => setAllocation('overlap')} className={`px-2 py-1 rounded text-xs ${allocation === 'overlap' ? 'bg-amber-600 text-white' : 'bg-gray-200'}`} title="Count shared tenants fully in each selected tag">Overlap</button>
                            </div>
                          )}
                        </div>
                      </>
                    ) : chart === 'sales' ? (
                      <div className="flex items-center gap-2">
                        <button onClick={() => setSalesMode('level')} className={`px-3 py-1 rounded ${salesMode === 'level' ? 'bg-slate-800 text-white' : 'bg-gray-200'}`}>Level</button>
                        <button onClick={() => setSalesMode('mom')} className={`px-3 py-1 rounded ${salesMode === 'mom' ? 'bg-slate-800 text-white' : 'bg-gray-200'}`}>MoM %</button>
                        <button onClick={() => setSalesMode('yoy')} className={`px-3 py-1 rounded ${salesMode === 'yoy' ? 'bg-slate-800 text-white' : 'bg-gray-200'}`}>YoY %</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="inline-flex rounded overflow-hidden border">
                          <button onClick={() => setEngageMetric('visits')} className={`px-3 py-1 ${engageMetric === 'visits' ? 'bg-slate-800 text-white' : 'bg-gray-200'}`}>Visits</button>
                          <button onClick={() => setEngageMetric('memberships')} className={`px-3 py-1 ${engageMetric === 'memberships' ? 'bg-slate-800 text-white' : 'bg-gray-200'}`}>Memberships</button>
                        </div>
                        <div className="inline-flex rounded overflow-hidden border">
                          <button onClick={() => setEngagePeriod('daily')} className={`px-3 py-1 ${engagePeriod === 'daily' ? 'bg-slate-800 text-white' : 'bg-gray-200'}`} disabled={engageMetric === 'memberships'}>Daily</button>
                          <button onClick={() => setEngagePeriod('monthly')} className={`px-3 py-1 ${engagePeriod === 'monthly' ? 'bg-slate-800 text-white' : 'bg-gray-200'}`}>Monthly</button>
                          <button onClick={() => setEngagePeriod('yearly')} className={`px-3 py-1 ${engagePeriod === 'yearly' ? 'bg-slate-800 text-white' : 'bg-gray-200'}`} disabled={engageMetric === 'memberships'}>Yearly</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {chart === 'bar' && chartMode === 'individual' && (
                  <div className="h-[480px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={individualBarData} margin={{ top: 10, right: 20, left: 60, bottom: 100 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" angle={-35} textAnchor="end" height={100} />
                        <YAxis tickFormatter={(v) => v.toLocaleString()} />
                        <Tooltip />
                        <Legend verticalAlign="top" height={36} />
                        <Bar
                          dataKey="value"
                          name={metric === 'space' ? 'Space (ft²)' : rentPeriod === 'monthly' ? 'Rent (Monthly, HKD)' : 'Rent (Annual, HKD)'}
                          fill="#8884d8"
                        >
                          {individualBarData.map((entry, idx) => {
                            let fill = entry.landUse === 'Office (Land Use)' ? '#0088FE' : '#00C49F';
                            if (selectedTags.length) {
                              const matchIdx = selectedTags.findIndex((t) => entry.tags.includes(t));
                              if (matchIdx >= 0) fill = COLORS[matchIdx % COLORS.length];
                            }
                            return <Cell key={`cell-${idx}`} fill={fill} />;
                          })}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {chart === 'bar' && chartMode === 'grouped' && (
                  <div className="h-[480px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={groupedBarData} margin={{ top: 10, right: 20, left: 60, bottom: 100 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" angle={-35} textAnchor="end" height={100} />
                        <YAxis tickFormatter={(v) => (valueMode === 'percent' ? `${v.toFixed(0)}%` : metric === 'count' ? String(v) : v.toLocaleString())} />
                        <Tooltip formatter={(v: any) => (valueMode === 'percent' ? `${Number(v).toFixed(1)}%` : Number(v).toLocaleString())} />
                        <Legend verticalAlign="top" height={36} />
                        <Bar
                          dataKey="value"
                          name={
                            valueMode === 'percent'
                              ? metric === 'space'
                                ? '% Space'
                                : '% Rent'
                              : metric === 'space'
                              ? 'Space (ft²)'
                              : rentPeriod === 'monthly'
                              ? 'Rent (Monthly, HKD)'
                              : 'Rent (Annual, HKD)'
                          }
                          fill="#0088FE"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {chart === 'bar' && chartMode === 'country' && (
                  <div className="h-[480px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={countryGroupedData} margin={{ top: 10, right: 20, left: 60, bottom: 100 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" angle={-35} textAnchor="end" height={100} />
                        <YAxis tickFormatter={(v) => (valueMode === 'percent' ? `${v.toFixed(0)}%` : metric === 'count' ? String(v) : v.toLocaleString())} />
                        <Tooltip formatter={(v: any) => (valueMode === 'percent' ? `${Number(v).toFixed(1)}%` : Number(v).toLocaleString())} />
                        <Legend verticalAlign="top" height={36} />
                        <Bar
                          dataKey="value"
                          name={
                            valueMode === 'percent'
                              ? metric === 'space'
                                ? '% Space by Country'
                                : metric === 'rent'
                                ? '% Rent by Country'
                                : '% Count by Country'
                              : metric === 'space'
                              ? 'Space (ft²) by Country'
                              : metric === 'rent' && rentPeriod === 'monthly'
                              ? 'Rent (Monthly, HKD) by Country'
                              : metric === 'rent'
                              ? 'Rent (Annual, HKD) by Country'
                              : 'Tenants by Country'
                          }
                          fill="#00C49F"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {chart === 'bar' && chartMode === 'building' && (
                  <div className="h-[480px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={buildingGroupedData} margin={{ top: 10, right: 20, left: 60, bottom: 100 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" angle={-35} textAnchor="end" height={100} />
                        <YAxis tickFormatter={(v) => (valueMode === 'percent' ? `${v.toFixed(0)}%` : metric === 'count' ? String(v) : v.toLocaleString())} />
                        <Tooltip formatter={(v: any) => (valueMode === 'percent' ? `${Number(v).toFixed(1)}%` : Number(v).toLocaleString())} />
                        <Legend verticalAlign="top" height={36} />
                        <Bar
                          dataKey="value"
                          name={
                            valueMode === 'percent'
                              ? metric === 'space'
                                ? '% Space'
                                : '% Rent'
                              : metric === 'space'
                              ? 'Space (ft²)'
                              : rentPeriod === 'monthly'
                              ? 'Rent (Monthly, HKD)'
                              : 'Rent (Annual, HKD)'
                          }
                          fill="#82ca9d"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {chart === 'bar' && chartMode === 'floor' && (
                  <div className="h-[480px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={floorGroupedData} margin={{ top: 10, right: 20, left: 60, bottom: 100 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" angle={-35} textAnchor="end" height={100} />
                        <YAxis tickFormatter={(v) => (valueMode === 'percent' ? `${v.toFixed(0)}%` : metric === 'count' ? String(v) : v.toLocaleString())} />
                        <Tooltip formatter={(v: any) => (valueMode === 'percent' ? `${Number(v).toFixed(1)}%` : Number(v).toLocaleString())} />
                        <Legend verticalAlign="top" height={36} />
                        <Bar
                          dataKey="value"
                          name={
                            valueMode === 'percent'
                              ? metric === 'space'
                                ? '% Space'
                                : '% Rent'
                              : metric === 'space'
                              ? 'Space (ft²)'
                              : rentPeriod === 'monthly'
                              ? 'Rent (Monthly, HKD)'
                              : 'Rent (Annual, HKD)'
                          }
                          fill="#ffc658"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {chart === 'pie' && (
                  <div className="h-[460px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={chartMode === 'country' ? countryGroupedData : chartMode === 'building' ? buildingGroupedData : chartMode === 'floor' ? floorGroupedData : pieData}
                          dataKey="value"
                          nameKey="name"
                          outerRadius={120}
                          label={(d: any) =>
                            `${d.name}${valueMode === 'percent' ? ` ${d.value.toFixed(1)}%` : ''}`
                          }
                        >
                          {(chartMode === 'country' ? countryGroupedData : chartMode === 'building' ? buildingGroupedData : chartMode === 'floor' ? floorGroupedData : pieData).map((_, i) => (
                            <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(val: any, n: any) =>
                            valueMode === 'percent'
                              ? [`${Number(val).toFixed(1)}%`, n]
                              : [Number(val).toLocaleString(), n]
                          }
                        />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {chart === 'scatter' && (
                  <div className="h-[460px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ReScatterChart>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="x" name="Floorspace" unit=" ft²" tickFormatter={(v: any) => `${(v / 1000).toFixed(0)}k`} />
                        <YAxis dataKey="y" name="Rent" tickFormatter={(v: any) => `${(v / 1000).toFixed(0)}k`} />
                        <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                        <Legend />
                        <Scatter name="Tenants" data={scatterData} fill="#00C49F">
                          {scatterData.map((d, i) => (
                            <Cell key={`sc-${i}`} fill={d.fill} />
                          ))}
                        </Scatter>
                      </ReScatterChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {chart === 'sales' && (
                  <div>
                    <div className="h-[460px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={salesChart.rows} margin={{ top: 10, right: 20, left: (salesMode === 'level' ? 70 : 50), bottom: 40 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="period" angle={-35} textAnchor="end" height={60} />
                          <YAxis width={salesMode === 'level' ? 70 : 60} tickFormatter={(v) => salesMode === 'level' ? Number(v).toLocaleString() : `${Number(v).toFixed(0)}%`} />
                          <Tooltip formatter={(v: any, n: any) => salesMode === 'level' ? [Number(v).toLocaleString(), n] : [`${Number(v).toFixed(1)}%`, n]} />
                          <Legend />
                          {salesChart.keys.map((k, i) => (
                            <Line key={k} type="monotone" dataKey={k} dot={false} stroke={COLORS[i % COLORS.length]} />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    {selectedTenants.length > 0 && (
                      <div className="mt-6 pt-4 border-t grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-3">
                        {selectedTenants.filter((t) => t.landUse === 'Retail (Land Use)' && Array.isArray(t.salesMonthly) && t.salesMonthly.length).map((t, i) => {
                          const lastSales = t.salesMonthly![t.salesMonthly!.length - 1].sales || 0;
                          const { monthlyRatio, annualRatio } = computeRentToSales(t);
                          return (
                            <div key={`rs-${t.id}`} className="border rounded-lg p-3">
                              <div className="flex items-center justify-between">
                                <div className="font-medium">{t.name}</div>
                                <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                              </div>
                              <div className="text-sm text-gray-600 mt-2">
                                <div>Latest Monthly Sales: HKD {formatNumber(lastSales)}</div>
                                <div>Monthly Rent: HKD {formatNumber(t.monthlyRent)}</div>
                                <div>Rent-to-Sales: {monthlyRatio != null ? `${monthlyRatio.toFixed(1)}% (mo)` : '—'}</div>
                                <div>Rent/Sales (Last 12m): {annualRatio != null ? `${annualRatio.toFixed(1)}% (ann)` : '—'}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {chart === 'engagement' && (
                  <div>
                    <div className="h-[460px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={engagementChart.rows} margin={{ top: 10, right: 20, left: 70, bottom: 40 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="period" angle={-35} textAnchor="end" height={60} />
                          <YAxis width={70} tickFormatter={(v) => Number(v).toLocaleString()} />
                          <Tooltip formatter={(v: any, n: any) => [Number(v).toLocaleString(), n]} />
                          <Legend />
                          {engagementChart.keys.map((k, i) => (
                            <Line key={k} type="monotone" dataKey={k} dot={false} stroke={COLORS[i % COLORS.length]} />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    {selectedTenants.length > 0 && (
                      <div className="mt-6 pt-4 border-t grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-3">
                        {selectedTenants.filter((t) => (t.tags.includes('Fitness') || t.tags.includes('Third Space'))).map((t, i) => {
                          const memberships = (t as any).membershipsMonthly as { month: string; members: number }[] | undefined;
                          const visitsMonthly = (t as any).visitsMonthly as { month: string; visits: number }[] | undefined;
                          const latestMembers = memberships && memberships.length ? memberships[memberships.length - 1].members : null;
                          const latestVisits = visitsMonthly && visitsMonthly.length ? visitsMonthly[visitsMonthly.length - 1].visits : null;
                          return (
                            <div key={`eg-${t.id}`} className="border rounded-lg p-3">
                              <div className="flex items-center justify-between">
                                <div className="font-medium">{t.name}</div>
                                <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                              </div>
                              <div className="text-sm text-gray-600 mt-2">
                                <div>Latest Monthly Members: {latestMembers != null ? formatNumber(latestMembers) : '—'}</div>
                                <div>Latest Monthly Visits: {latestVisits != null ? formatNumber(latestVisits) : '—'}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Comparison summary */}
                {selectedTags.length > 0 && (
                  <div className="mt-6 border-t pt-4">
                    <h4 className="font-semibold mb-3">Comparison Summary</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-3">
                      {selectedTagGroups.map((g, i) => {
                        const total = selectedTagGroups.reduce(
                          (s, it) => s + (metric === 'space' ? it.space : it.rent),
                          0
                        ) || 1;
                        const share =
                          ((metric === 'space' ? g.space : g.rent) / total) * 100;
                        return (
                          <div key={g.name} className="border rounded-lg p-3">
                            <div className="flex items-center justify-between">
                              <div className="font-medium">{g.name}</div>
                              <span
                                className="inline-block w-3 h-3 rounded"
                                style={{ backgroundColor: COLORS[i % COLORS.length] }}
                              />
                            </div>
                            <div className="text-sm text-gray-600 mt-2">
                              <div>Tenants: {g.count}</div>
                              <div>Space: {formatNumber(g.space)} ft²</div>
                              <div>
                                Rent: HKD {formatNumber(g.rent)}
                              </div>
                              <div>Avg Rent/ft² (mo): HKD {g.avgRpsf.toFixed(2)}</div>
                              <div>Share ({metric === 'space' ? 'Space' : 'Rent'}): {share.toFixed(1)}%</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Tenant List ({filteredTenants.length})</h3>
                  <div className="text-sm text-gray-600">
                    Showing {Math.min(30, filteredTenants.length)} of {filteredTenants.length}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Location</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Floor</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Country</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Land Use</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Space</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Rent/ft² (mo)</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">{rentPeriod === 'monthly' ? 'Monthly Rent' : 'Annual Rent'}</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Tags</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {filteredTenants.slice(0, 30).map((t) => (
                        <tr
                          key={t.id}
                          className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => setSelectedTenant(t)}
                        >
                          <td className="px-4 py-2 text-sm font-medium text-gray-900">{t.name}</td>
                          <td className="px-4 py-2 text-sm text-gray-600">{t.location}</td>
                          <td className="px-4 py-2 text-sm text-gray-600">{t.floor || '—'}</td>
                          <td className="px-4 py-2 text-sm text-gray-600">{t.country || 'Unknown'}</td>
                          <td className="px-4 py-2 text-sm text-gray-600">{t.landUse.replace(' (Land Use)', '')}</td>
                          <td className="px-4 py-2 text-sm text-gray-600 text-right">{formatNumber(t.floorspace)}</td>
                          <td className="px-4 py-2 text-sm text-gray-600 text-right">{t.rentPerSqFt.toFixed(2)}</td>
                          <td className="px-4 py-2 text-sm text-gray-600 text-right">{formatNumber(rentPeriod === 'monthly' ? t.monthlyRent : t.annualRent)}</td>
                          <td className="px-4 py-2 text-sm text-gray-600">
                            <div className="flex flex-wrap gap-1">
                              {t.tags.map((tag) => (
                                <span key={`${t.id}-${tag}`} className={`px-2 py-0.5 rounded text-xs ${tagPillClass(tag)}`}>
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Tenant modal */}
                {selectedTenant && (
                  <div
                    className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
                    onClick={() => setSelectedTenant(null)}
                  >
                    <div className="bg-white rounded-lg p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-lg font-semibold">{selectedTenant.name}</h4>
                        <button onClick={() => setSelectedTenant(null)} className="px-2 py-1 rounded hover:bg-gray-100">✕</button>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div><strong>Location:</strong> {selectedTenant.location}</div>
                        <div><strong>Floor:</strong> {selectedTenant.floor || '—'}</div>
                        <div><strong>Country:</strong> {selectedTenant.country || 'Unknown'}</div>
                        <div><strong>Land Use:</strong> {selectedTenant.landUse}</div>
                        <div><strong>Floorspace:</strong> {formatNumber(selectedTenant.floorspace)} ft²</div>
                        <div><strong>Rent/ft² (monthly):</strong> HKD {selectedTenant.rentPerSqFt.toFixed(2)}</div>
                        <div>
                          <strong>{rentPeriod === 'monthly' ? 'Monthly' : 'Annual'} Rent:</strong> HKD {formatNumber(rentPeriod === 'monthly' ? selectedTenant.monthlyRent : selectedTenant.annualRent)}
                        </div>
                        <div><strong>Occupancy:</strong> {selectedTenant.occupancyRate.toFixed(1)}%</div>
                        <div><strong>Lease:</strong> {selectedTenant.leaseStart} – {selectedTenant.leaseEnd} ({selectedTenant.leaseYears} yrs)</div>
                        <div>
                          <strong>Tags:</strong>
                          <div className="flex flexj-wrap gap-1 mt-1">
                            {selectedTenant.tags.map((tag) => (
                              <span key={`modal-${tag}`} className={`px-2 py-0.5 rounded text-xs ${tagPillClass(tag)}`}>
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Export modal moved to top-level to be available in all views */}
              </div>
            )}
          </div>
        </div>

        {/* Notes */}
        <div className="text-sm text-gray-600 mt-6">
          <p>- Use Individual view to compare tenants directly; Grouped view aggregates by selected tags (or Land Use if none).</p>
          <p>- Tag search shows hierarchy paths for discovery; selection is not hierarchical.</p>
          <p>- Toggle % Share for grouped charts to view relative contributions.</p>
        </div>
        {/* Export modal at root so it works in both Charts and Table views */}
        {exportOpen && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
            onClick={() => setExportOpen(false)}
          >
            <div className="bg-white rounded-lg p-6 w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-lg font-semibold">Export to CSV</h4>
                <button onClick={() => setExportOpen(false)} className="px-2 py-1 rounded hover:bg-gray-100">✕</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <div className="text-sm font-medium mb-2">Scope</div>
                  <label className="flex items-center gap-2 text-sm py-1">
                    <input
                      type="radio"
                      className="h-4 w-4"
                      checked={exportScope === 'filtered'}
                      onChange={() => setExportScope('filtered')}
                    />
                    <span>Filtered tenants ({filteredTenants.length})</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm py-1">
                    <input
                      type="radio"
                      className="h-4 w-4"
                      checked={exportScope === 'selected'}
                      onChange={() => setExportScope('selected')}
                    />
                    <span>Only selected tenants ({selectedTenants.length})</span>
                  </label>
                </div>
                <div>
                  <div className="text-sm font-medium mb-2">Base</div>
                  <div className="border rounded-lg">
                    <button
                      className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50"
                      onClick={() => setBaseDropdownOpen((s) => !s)}
                    >
                      <span className="flex items-center gap-2">
                        <input type="checkbox" className="h-4 w-4" checked={includeBaseGroup} onChange={(e) => setIncludeBaseGroup(e.target.checked)} />
                        <span>Identity & location</span>
                      </span>
                      <span className="text-gray-500">{baseDropdownOpen ? '▴' : '▾'}</span>
                    </button>
                    {baseDropdownOpen && (
                      <div className="px-3 pb-2 pt-1 border-t grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                        <label className="flex items-center gap-2 py-1"><input type="checkbox" className="h-4 w-4" checked={includeBaseId} onChange={(e) => setIncludeBaseId(e.target.checked)} /><span>Id</span></label>
                        <label className="flex items-center gap-2 py-1"><input type="checkbox" className="h-4 w-4" checked={includeBaseName} onChange={(e) => setIncludeBaseName(e.target.checked)} /><span>Name</span></label>
                        <label className="flex items-center gap-2 py-1"><input type="checkbox" className="h-4 w-4" checked={includeBaseLocation} onChange={(e) => setIncludeBaseLocation(e.target.checked)} /><span>Location</span></label>
                        <label className="flex items-center gap-2 py-1"><input type="checkbox" className="h-4 w-4" checked={includeBaseFloor} onChange={(e) => setIncludeBaseFloor(e.target.checked)} /><span>Floor</span></label>
                        <label className="flex items-center gap-2 py-1"><input type="checkbox" className="h-4 w-4" checked={includeBaseCountry} onChange={(e) => setIncludeBaseCountry(e.target.checked)} /><span>Country</span></label>
                        <label className="flex items-center gap-2 py-1"><input type="checkbox" className="h-4 w-4" checked={includeBaseLandUse} onChange={(e) => setIncludeBaseLandUse(e.target.checked)} /><span>Land use</span></label>
                      </div>
                    )}
                  </div>

                  <div className="border rounded-lg mt-3">
                    <button
                      className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50"
                      onClick={() => setSpaceDropdownOpen((s) => !s)}
                    >
                      <span className="flex items-center gap-2">
                        <input type="checkbox" className="h-4 w-4" checked={includeSpaceGroup} onChange={(e) => setIncludeSpaceGroup(e.target.checked)} />
                        <span>Space</span>
                      </span>
                      <span className="text-gray-500">{spaceDropdownOpen ? '▴' : '▾'}</span>
                    </button>
                    {spaceDropdownOpen && (
                      <div className="px-3 pb-2 pt-1 border-t grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                        <label className="flex items-center gap-2 py-1"><input type="checkbox" className="h-4 w-4" checked={includeSpaceFloorspace} onChange={(e) => setIncludeSpaceFloorspace(e.target.checked)} /><span>Floor area (ft²)</span></label>
                      </div>
                    )}
                  </div>

                  <div className="border rounded-lg mt-3">
                    <button
                      className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50"
                      onClick={() => setRentDropdownOpen((s) => !s)}
                    >
                      <span className="flex items-center gap-2">
                        <input type="checkbox" className="h-4 w-4" checked={includeRentGroup} onChange={(e) => setIncludeRentGroup(e.target.checked)} />
                        <span>Rent & lease</span>
                      </span>
                      <span className="text-gray-500">{rentDropdownOpen ? '▴' : '▾'}</span>
                    </button>
                    {rentDropdownOpen && (
                      <div className="px-3 pb-2 pt-1 border-t grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                        <label className="flex items-center gap-2 py-1"><input type="checkbox" className="h-4 w-4" checked={includeRentPerSqFt} onChange={(e) => setIncludeRentPerSqFt(e.target.checked)} /><span>Rent/ft² (monthly)</span></label>
                        <label className="flex items-center gap-2 py-1"><input type="checkbox" className="h-4 w-4" checked={includeMonthlyRent} onChange={(e) => setIncludeMonthlyRent(e.target.checked)} /><span>Monthly rent</span></label>
                        <label className="flex items-center gap-2 py-1"><input type="checkbox" className="h-4 w-4" checked={includeAnnualRent} onChange={(e) => setIncludeAnnualRent(e.target.checked)} /><span>Annual rent</span></label>
                        <label className="flex items-center gap-2 py-1"><input type="checkbox" className="h-4 w-4" checked={includeOccupancyRate} onChange={(e) => setIncludeOccupancyRate(e.target.checked)} /><span>Occupancy %</span></label>
                        <label className="flex items-center gap-2 py-1"><input type="checkbox" className="h-4 w-4" checked={includeLeaseYears} onChange={(e) => setIncludeLeaseYears(e.target.checked)} /><span>Lease years</span></label>
                        <label className="flex items-center gap-2 py-1"><input type="checkbox" className="h-4 w-4" checked={includeLeaseStart} onChange={(e) => setIncludeLeaseStart(e.target.checked)} /><span>Lease start</span></label>
                        <label className="flex items-center gap-2 py-1"><input type="checkbox" className="h-4 w-4" checked={includeLeaseEnd} onChange={(e) => setIncludeLeaseEnd(e.target.checked)} /><span>Lease end</span></label>
                      </div>
                    )}
                  </div>

                  <label className="flex items-center gap-2 text-sm py-3">
                    <input type="checkbox" className="h-4 w-4" checked={includeTagsField} onChange={(e) => setIncludeTagsField(e.target.checked)} />
                    <span>Tags</span>
                  </label>
                </div>
                <div className="md:col-span-2">
                  <div className="text-sm font-medium mb-2 flex items-center justify-between">
                    <span>Sales (Retail)</span>
                    <span className="text-xs text-gray-500">Pick summaries or detail columns</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 text-sm py-1">
                      <input type="checkbox" className="h-4 w-4" checked={includeSalesLatest} onChange={(e) => setIncludeSalesLatest(e.target.checked)} />
                      <span>Latest monthly sales</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm py-1">
                      <input type="checkbox" className="h-4 w-4" checked={includeSalesLTM} onChange={(e) => setIncludeSalesLTM(e.target.checked)} />
                      <span>Sales LTM (last 12 months)</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm py-1">
                      <input type="checkbox" className="h-4 w-4" checked={includeRentToSalesMonthly} onChange={(e) => setIncludeRentToSalesMonthly(e.target.checked)} />
                      <span>Rent-to-sales monthly %</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm py-1">
                      <input type="checkbox" className="h-4 w-4" checked={includeRentToSalesAnnual} onChange={(e) => setIncludeRentToSalesAnnual(e.target.checked)} />
                      <span>Rent-to-sales annual %</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm py-1 md:col-span-2">
                      <input type="checkbox" className="h-4 w-4" checked={includeSalesMonthlySeries} onChange={(e) => setIncludeSalesMonthlySeries(e.target.checked)} />
                      <span>Monthly sales series (adds one column per month)</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm py-1 md:col-span-2">
                      <input type="checkbox" className="h-4 w-4" checked={includeSalesYearly} onChange={(e) => setIncludeSalesYearly(e.target.checked)} />
                      <span>Yearly sales (adds one column per year)</span>
                    </label>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 mt-6">
                <button onClick={() => setExportOpen(false)} className="px-3 py-2 rounded border">Cancel</button>
                <button onClick={handleConfirmExportCsv} className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">Export</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
