// Build a fresh, balanced synthetic dataset for demo purposes.
// Outputs public/data/tenants_demo.json
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const DATA_DIR = path.join(ROOT, 'public', 'data')
const OUT_JSON = path.join(DATA_DIR, 'tenants_demo.json')

const LAND_USE = ['Office (Land Use)', 'Retail (Land Use)']

const SECONDARY_TO_TERTIARY = {
	'F&B': ['Café', 'Restaurant', 'Bakery', 'Grab and Go', 'Food Hall', 'Bar'],
	'Retail and Convenience': ['Banking', 'Beauty', 'Health', 'Fashion (Shopping)', 'Smart Locker'],
	'Third Space': ["Event Space", "Member's Club", 'Co-working spaces'],
	'Fitness': ['Golf', 'Gym', 'Movement Studio', 'Yoga Studio', 'Physiotherapy'],
	'Healthcare': ['Dental Clinic', 'Medical Clinic'],
	'Trade Categories': [
		'Banking and Financial Services',
		'Technology Media and Telecoms (TMT)',
		'Insurance',
		'Real Estate and Construction',
		'Fashion/Retail',
	],
}

function landUseBySecondary(secondary) {
	if (secondary === 'Trade Categories') return 'Office (Land Use)'
	if (secondary === 'F&B' || secondary === 'Retail and Convenience') return 'Retail (Land Use)'
	return 'Office (Land Use)'
}

function randInt(min, max) {
	return Math.floor(Math.random() * (max - min + 1)) + min
}

function sizeFromLandUse(landUse) {
	return landUse === 'Retail (Land Use)' ? randInt(600, 12000) : randInt(6000, 60000)
}

function rentPerSfFromLandUse(landUse, premium) {
	const base = landUse === 'Retail (Land Use)' ? randInt(60, 120) : randInt(40, 70)
	return premium ? Math.round(base * 1.15) : base
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }

const LOCATIONS = ['OTP', 'TTP', 'PCT', 'BEH', 'OXH', 'LIH', 'DOH', 'DEH', 'CAH', 'OIE']

// Country of origin distribution (approximate)
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
]
const COUNTRY_WEIGHTS = {
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
}
function pickCountry() {
  const r = Math.random()
  let acc = 0
  for (const c of COUNTRIES) {
    acc += COUNTRY_WEIGHTS[c] || 0
    if (r <= acc) return c
  }
  return COUNTRIES[0]
}

function generateBrandName(secondary, tertiary, landUse) {
  const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)]

  // Retail: curated brand-like names
  const cafe = [
    'Daily Grind', 'Harbour Roastery', 'Bean & Co', 'Copper Mug Café', 'Cuppa House', 'Seaside Coffee', 'Urban Brew Lab', 'Lotus Café', 'Bayview Espresso', 'Metro Beans'
  ]
  const restaurant = [
    'Juniper Kitchen', 'The Willow Bistro', 'Copper & Stone', 'Harbourhouse', 'North & Ivy', 'Atlas Kitchen', 'Pearl & Pine', 'The Lantern Room', 'Orchid Table', 'Skyline Eatery'
  ]
  const bakery = [
    'Crumbs & Crust', 'Flour Room', 'Sugar & Whisk', 'Butter Lane', 'Golden Oven', 'Morning Bun', 'Rye & Rind', 'Sweet Hearth', 'Starlight Bakes', 'Pastry Atelier'
  ]
  const grabAndGo = [
    'QuickBite', 'GoBento', 'Wrap & Roll', 'Noodle Box', 'Grain & Greens', 'City Bites', 'Pocket Pasta', 'Rice & Go', 'Soba Sprint', 'Dash Deli'
  ]
  const foodHall = [
    'The Food Atrium', 'Market Lane Hall', 'The Pantry Hall', 'Gather Food Hall', 'Harbour Eats', 'City Market Hall'
  ]
  const bar = [
    'The Copper Fox', 'Juniper Room', 'The Kingfisher', 'Bar Orion', 'Neon & Tonic', 'The Evening Post', 'Nightjar', 'The Lighthouse Bar', 'Amber & Oak', 'Blue Lantern'
  ]

  // Retail & Convenience
  const bankingRetail = ['Harbour Bank', 'Union Trust Bank', 'Central Savings Bank', 'Metro Finance Bank']
  const beauty = ['Glow Studio', 'Luxe Nails', 'Bloom Beauty', 'Velvet Salon', 'Rose & Amber']
  const healthRetail = ['Wellness Mart', 'Herb & Care', 'Vital Health Store', 'Pure Remedy', 'Care+ Pharmacy']
  const fashion = ['Verve Apparel', 'Elm & Ivy', 'Atlas Outfitters', 'Copper Thread', 'Northshore Clothiers', 'Midnight & Dawn']
  const locker = ['QuickBox Locker', 'ParcelNow Locker', 'SwiftLocker', 'DropPoint Locker']

  // Third Space
  const eventSpace = ['The Atrium', 'Harbour Hall', 'The Assembly', 'Skyline Event Space', 'Gallery 8']
  const membersClub = ['The Exchange Club', 'The Foundry Club', 'The Observatory', 'Club Meridian']
  const coworking = ['Blueprint Co-works', 'Anchor Co-working', 'Harbour Works', 'Founders Studio']

  // Fitness
  const golf = ['Urban Golf Lab', 'Harbour Golf Studio', 'Greenline Golf']
  const gym = ['Pulse Fitness', 'Ironworks Gym', 'Core District', 'Peak Performance Gym']
  const movement = ['Flow Movement Studio', 'Kinetic Room', 'Motion & Form', 'Movement Lab']
  const yoga = ['Lotus Yoga Studio', 'Sun & Moon Yoga', 'Prana House', 'Riverstone Yoga']
  const physio = ['Peak Physio Clinic', 'Harbour Physio', 'MotionCare Physiotherapy']

  // Healthcare
  const dental = ['Harbour Dental Clinic', 'Central Dental Studio', 'Cedar Dental']
  const medical = ['Central Medical Centre', 'Harbour Medical', 'Orchid Medical Clinic']

  // Corporate-style names for Trade Categories and generic office brands
  const corpPrefixes = ['Harbour', 'Zenith', 'Aurora', 'Pinnacle', 'Summit', 'Bridgewater', 'Silverline', 'Northwood', 'BlueRock', 'Everstone', 'Crestpoint', 'Oakridge', 'Stonegate']
  const corpCore = {
    'Banking and Financial Services': ['Capital', 'Securities', 'Asset Management', 'Advisors', 'Holdings', 'Partners', 'Wealth'],
    'Technology Media and Telecoms (TMT)': ['Technologies', 'Systems', 'Digital', 'Networks', 'Media', 'Labs', 'Solutions'],
    'Insurance': ['Insurance', 'Assurance', 'Risk', 'Underwriters', 'Mutual'],
    'Real Estate and Construction': ['Real Estate', 'Properties', 'Construction', 'Development', 'Builders', 'Holdings'],
    'Fashion/Retail': ['Retail', 'Brands', 'Apparel', 'Trading', 'Group']
  }
  const legalSuffix = () => (Math.random() < 0.7 ? ' Limited' : '')

  const sec = secondary || ''
  const ter = tertiary || ''

  if (sec === 'F&B') {
    if (ter === 'Café') return pickOne(cafe)
    if (ter === 'Restaurant') return pickOne(restaurant)
    if (ter === 'Bakery') return pickOne(bakery)
    if (ter === 'Grab and Go') return pickOne(grabAndGo)
    if (ter === 'Food Hall') return pickOne(foodHall)
    if (ter === 'Bar') return pickOne(bar)
  }
  if (sec === 'Retail and Convenience') {
    if (ter === 'Banking') return pickOne(bankingRetail)
    if (ter === 'Beauty') return pickOne(beauty)
    if (ter === 'Health') return pickOne(healthRetail)
    if (ter === 'Fashion (Shopping)') return pickOne(fashion)
    if (ter === 'Smart Locker') return pickOne(locker)
  }
  if (sec === 'Third Space') {
    if (ter === 'Event Space') return pickOne(eventSpace)
    if (ter === "Member's Club") return pickOne(membersClub)
    if (ter === 'Co-working spaces') return pickOne(coworking)
  }
  if (sec === 'Fitness') {
    if (ter === 'Golf') return pickOne(golf)
    if (ter === 'Gym') return pickOne(gym)
    if (ter === 'Movement Studio') return pickOne(movement)
    if (ter === 'Yoga Studio') return pickOne(yoga)
    if (ter === 'Physiotherapy') return pickOne(physio)
  }
  if (sec === 'Healthcare') {
    if (ter === 'Dental Clinic') return pickOne(dental)
    if (ter === 'Medical Clinic') return pickOne(medical)
  }
  if (sec === 'Trade Categories') {
    const coreList = corpCore[ter] || ['Holdings', 'Group', 'Partners']
    return `${pickOne(corpPrefixes)} ${pickOne(coreList)}${legalSuffix()}`
  }

  // Generic fallback
  const genericAdj = ['Harbour', 'Central', 'Pacific', 'Orchid', 'Jade', 'Lion Rock', 'Star', 'Pearl', 'Skyline', 'Bayview']
  const genericNoun = landUse === 'Retail (Land Use)'
    ? ['Market', 'Collective', 'House', 'Boutique', 'Corner', 'Arcade', 'Emporium']
    : ['Group', 'Holdings', 'Studios', 'Works', 'Collective', 'Partners', 'Ventures', 'Labs']
  return `${pickOne(genericAdj)} ${pickOne(genericNoun)}`
}

function buildDataset() {
	const tenants = []
	let nextId = 1
  let locationCursor = 0

	// Balance: create N tenants per tertiary across secondaries
	const tenantsPerLeaf = 6 // adjust for volume
	for (const [secondary, leaves] of Object.entries(SECONDARY_TO_TERTIARY)) {
		for (const leaf of leaves) {
			for (let i = 0; i < tenantsPerLeaf; i++) {
				const lu = landUseBySecondary(secondary)
				const premium = Math.random() > 0.6
				const floorspace = sizeFromLandUse(lu)
				const rpsf = rentPerSfFromLandUse(lu, premium)
				const monthly = Math.round(floorspace * rpsf)
				const annual = monthly * 12
				const leaseYears = pick([3, 5, 7, 10])
				const leaseStart = String(2019 + randInt(0, 5))
				const leaseEnd = String(Number(leaseStart) + leaseYears)
				const includeAmenity = secondary !== 'Trade Categories'
				const name = generateBrandName(secondary, leaf, lu)
				const tags = [lu]
				if (includeAmenity) tags.push('Amenity')
				tags.push(secondary)
				tags.push(leaf)
				let tenant = {
					id: nextId++,
					name,
					location: LOCATIONS[locationCursor++ % LOCATIONS.length],
					country: pickCountry(),
					landUse: lu,
					tags: Array.from(new Set(tags)),
					floorspace,
					rentPerSqFt: rpsf,
					monthlyRent: monthly,
					annualRent: annual,
					premium,
					leaseYears,
					leaseStart,
					leaseEnd,
					occupancyRate: 85 + Math.random() * 15,
					floor: `${randInt(1, 45)}/F`,
					canonicalName: name.toUpperCase().replace(/[^A-Z0-9]/g, ''),
				}
				// Add synthetic sales for retail tenants
				if (lu === 'Retail (Land Use)') {
					const monthsBack = 24
					const today = new Date()
					const factor = 18 + Math.random() * 8
					const base = floorspace * rpsf * factor
					const trend = (Math.random() - 0.5) * 0.08
					const salesMonthly = []
					for (let i = monthsBack - 1; i >= 0; i--) {
						const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
						const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
						const m = d.getMonth()
						const season = 1 + (m === 11 ? 0.18 : m === 0 ? 0.08 : m >= 5 && m <= 7 ? -0.06 : 0)
						const t = 1 + trend * ((monthsBack - 1 - i) / (monthsBack - 1))
						const noise = 1 + (Math.random() - 0.5) * 0.08
						const sales = Math.max(0, Math.round(base * season * t * noise))
						salesMonthly.push({ month: ym, sales })
					}
					const salesByYear = []
					const map = new Map()
					for (const r of salesMonthly) {
						const y = r.month.slice(0, 4)
						map.set(y, (map.get(y) || 0) + r.sales)
					}
					for (const [year, sales] of Array.from(map.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
						salesByYear.push({ year, sales })
					}
					tenant = { ...tenant, salesMonthly, salesByYear }
				}
				tenants.push(tenant)
			}
		}
	}

	return tenants
}

function main() {
	if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
	const tenants = buildDataset()
	fs.writeFileSync(OUT_JSON, JSON.stringify(tenants, null, 2), 'utf8')
	console.log(`Synthetic demo dataset written: ${OUT_JSON} (${tenants.length} tenants)`) 
}

main()


