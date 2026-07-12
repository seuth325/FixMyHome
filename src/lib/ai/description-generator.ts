import type { JobCategory } from '@/lib/constants';

export interface GeneratedDescription {
  text: string;
}

/**
 * Category-specific template factories.
 * Each function receives the job title and returns a ready-to-edit description draft
 * that guides the homeowner to include the details a handyman actually needs.
 */
const templates: Record<JobCategory, (title: string) => string> = {
  'Plumbing': (title) => `I need a licensed plumber to help with: ${title}.

Problem description:
The issue has been occurring for [how long — e.g., a few days / a week]. [Describe what you observe — e.g., constant dripping, slow drain, no water pressure, visible leak under sink, water stains on ceiling]. The affected fixture/area is located in my [kitchen / bathroom / laundry room / outdoor area].

Fixture details:
[Fixture type and brand if known — e.g., single-handle Moen faucet, PVC drain pipe, tankless water heater]. The home was built in approximately [year], and the plumbing is [original / partially updated / recently replaced].

Scope of work:
I am looking for someone to [diagnose / repair / replace] the issue. [Note any preferences — e.g., prefer to keep existing fixture style, open to full replacement if repair is not cost-effective].

Access & additional notes:
The shutoff valve is [accessible / unknown location]. I will be home during the work. [Add any access challenges — e.g., crawl space access, tight under-sink cabinet, second-floor bathroom]. Please include all parts and labor in your bid.`,

  'Electrical': (title) => `I need a licensed electrician to help with: ${title}.

Problem description:
[Describe the issue — e.g., outlet stopped working, breaker keeps tripping, lights flickering, want a new fixture installed]. The affected area is in my [room/location — e.g., master bedroom, kitchen, garage, outdoor patio].

Current setup:
My electrical panel is [100 amp / 200 amp / unknown]. The circuit involved is [single / double breaker]. [Note if there are any current safety concerns — e.g., burning smell, visible scorching, sparks observed].

Scope of work:
I need someone to [install / repair / inspect / replace] [describe what — e.g., a ceiling fan with existing wiring, three new outlets, GFCI protection in bathrooms]. [Note permit requirements — the work may / may not require a permit, please advise].

Access & additional notes:
The electrical panel is located in [garage / utility closet / hallway]. I will be home during the work. [Add any relevant details — e.g., home is occupied, pets present, specific scheduling constraints]. Please include all materials and labor in your quote.`,

  'HVAC & Air Conditioning': (title) => `I need a certified HVAC technician to help with: ${title}.

System details:
My AC unit is approximately [age — e.g., 8 years old]. Make/model: [brand and model if visible on the unit, or "unknown"]. The system is [central air / mini-split / window unit]. The air handler is located [inside / attic / closet] and the condenser is [outside on the side / roof].

Problem description:
[Describe what you're experiencing — e.g., unit runs but doesn't cool, strange rattling or grinding noise, ice forming on coils, system won't turn on, high humidity indoors despite AC running]. The thermostat currently reads [°F] but the actual indoor temperature is [°F]. The problem started [how long ago].

Recent maintenance:
The system was last serviced [when — e.g., 2 years ago / never since I moved in]. I [have / have not] replaced the air filter recently. [Note any prior repairs — e.g., refrigerant was added last year].

Scope of work:
I need a full diagnostic and [repair / tune-up / replacement estimate]. This is [urgent — South Florida heat / not immediately urgent]. Please include diagnostic fee and estimated repair cost in your bid.`,

  'Painting': (title) => `I need a professional painter to help with: ${title}.

Space details:
Room/area to be painted: [specify — e.g., living room, master bedroom, entire exterior, two-car garage]. Dimensions: approximately [W × L] feet with [8 / 9 / 10]-foot ceilings. Total linear feet of wall space: approximately [number, or leave blank for estimator to measure].

Current condition:
Walls are currently [color — e.g., beige / white / dark gray]. Surface condition: [good / minor scuffs and nail holes / significant damage needing repair]. [Note if there are water stains, mold spots, wallpaper to remove, or existing texture].

Scope of work:
I need [interior / exterior] painting including: complete prep work (spackling, sanding, caulking), primer coat where needed, and [one / two] finish coats. Paint brand preference: [any premium brand / Benjamin Moore / Sherwin-Williams / open to recommendation]. New color direction: [light neutral / dark accent / to match existing / I have a specific color in mind: ______].

Additional details:
[Heavy furniture to be moved — yes / no]. Florida sun exposure: [direct / partial / shaded]. [Note any special requests — e.g., trim and baseboards to be painted separately, ceiling included, textured finish desired]. Please include all paint, primer, and supplies in your bid.`,

  'Carpentry': (title) => `I need a skilled carpenter to help with: ${title}.

Project description:
[Describe the work in detail — e.g., build a custom built-in bookshelf, repair rotted deck boards, install crown molding throughout the main floor, replace a damaged interior door and frame].

Dimensions & materials:
[Provide measurements — e.g., bookshelf to be 8 ft wide × 9 ft tall, deck section is 12 × 6 ft]. Preferred wood species or material: [pine / oak / cedar / composite / match existing]. Current condition of existing wood/structure: [good / some rot / significant damage].

Scope of work:
I need someone to [design and build / repair / install / replace] [describe the item]. [Note if materials should be sourced by the handyman or if I will supply them]. [Mention any finish preferences — painted, stained, natural].

Access & additional notes:
The work area is [interior / exterior / covered porch]. [Note any HOA restrictions, Florida building code considerations, or permit requirements]. I would like a written quote before work begins. Please include all labor, fasteners, and finish materials in your bid.`,

  'Fence Repair': (title) => `I need a fence contractor to help with: ${title}.

Fence details:
Fence type: [wood privacy / chain-link / aluminum / vinyl / CBS block wall]. Total length needing repair: approximately [number] linear feet. The fence was originally installed approximately [years] ago.

Damage description:
[Describe the damage — e.g., 3 fence panels blown down from a storm, 5 rotted posts, gate won't latch properly, section leaning due to soil erosion, graffiti on block wall]. The damage is located on my [north / south / east / west] property line.

Scope of work:
I need: [post replacement / panel replacement / gate rehang / full section rebuild / painting or staining]. [Note if this is storm-related and may involve insurance — yes / no / not sure]. Materials should [match existing / I am open to a full upgrade].

Access & additional notes:
[Note any utility lines near the fence line — call 811 may be needed]. HOA approval: [required / not required / pending]. The property is [fenced yard with dogs — gate must stay closed]. Please include all posts, panels, hardware, and concrete footings in your bid.`,

  'Landscaping & Irrigation': (title) => `I need a landscaping or irrigation professional to help with: ${title}.

Property details:
Lot size: approximately [size — e.g., 0.25 acre / 50 × 100 ft lot]. Current landscaping condition: [well-maintained / overgrown / newly purchased home]. The yard is [fully irrigated / partial irrigation / no irrigation system].

Scope of work:
[Describe what is needed — e.g., install a new 6-zone irrigation system, repair broken sprinkler heads in zones 2 and 4, trim overgrown hedges along the front, remove two large palm trees, install sod in a bare 20 × 15 ft section, design and plant a Florida-friendly landscaping bed].

Specific issues:
[Add detail — e.g., irrigation controller is not working, several heads are not rotating, water pressure seems low, certain zones are not triggering, lawn has bare/dead patches in shaded areas]. Florida climate note: [property is in a [coastal / inland / shaded] area with [sandy / clay] soil].

Access & additional notes:
Water source for irrigation is [city water / well]. [Note any HOA landscaping restrictions]. Preferred plants/grass type: [St. Augustine / Zoysia / Bahia / Florida-friendly native plants / match existing]. Please provide a quote that includes all parts, plants, and labor.`,

  'General Handyman': (title) => `I need a reliable handyman to help with: ${title}.

Tasks needed:
[List each task clearly — e.g.:
1. Hang 6 framed pictures in the hallway
2. Fix a squeaky interior door
3. Replace weather stripping on front door
4. Patch two small drywall holes (fist-sized)
5. Tighten loose towel bar in master bath]

Details for each task:
[For each task above, add any relevant detail — materials needed, location in home, difficulty level]. I [have / do not have] the materials for these tasks and would like the handyman to [supply everything / use what I provide / advise on materials needed].

Home details:
The home is a [single-family / townhome / condo] built in approximately [year]. [Note any access requirements — gated community, second floor, crawl space]. I am [home all day / available after 3pm / flexible on scheduling].

Additional notes:
Please let me know if any of these tasks fall outside your skill set. I would prefer someone who can complete all items in a single visit to save on trip charges. Please include all labor and any materials in your bid.`,

  'Appliance Repair': (title) => `I need an appliance repair technician to help with: ${title}.

Appliance details:
Appliance type: [e.g., refrigerator / dishwasher / washing machine / dryer / oven / garbage disposal]. Make: [brand — e.g., Samsung / Whirlpool / LG / GE]. Model number: [if visible on label inside door/back panel]. Approximate age: [years old].

Problem description:
[Describe the symptom — e.g., refrigerator is not cooling but freezer works fine, washing machine makes loud grinding noise during spin cycle, dishwasher won't drain, oven doesn't heat to set temperature, dryer runs but clothes stay wet]. Error code displayed (if any): [code or "none"].

History:
The appliance [has never had issues / was repaired once before for a different problem]. [Note if it is still under manufacturer or extended warranty — yes / no / unsure].

Scope of work:
I would like a technician to diagnose and repair the issue. If the repair cost exceeds a reasonable threshold (approximately $[amount]), please [stop and advise before proceeding / proceed with the repair]. The appliance is located in my [kitchen / laundry room / garage]. Access is [straightforward / appliance needs to be pulled out from built-in space].`,

  'Flooring': (title) => `I need a flooring professional to help with: ${title}.

Area details:
Room(s) involved: [e.g., master bedroom, entire first floor, kitchen only]. Total square footage: approximately [number] sq ft. [Measure or estimate — length × width]. Current flooring type: [hardwood / laminate / tile / carpet / vinyl plank / concrete slab].

Current condition:
[Describe the issue or project — e.g., several hardwood planks are scratched and cupped from a water leak, carpet needs to be replaced throughout 3 bedrooms, tile is cracked in the kitchen, installing new LVP over existing subfloor]. The subfloor condition appears: [good / unknown / has soft spots / slight moisture issue].

Scope of work:
I need: [full removal and replacement / repair of specific damaged sections / installation over existing floor / refinishing of hardwood]. New flooring preference: [luxury vinyl plank / hardwood / large-format tile / carpet — color preference: ______]. Florida-specific: prefer [waterproof / moisture-resistant] materials due to humidity.

Access & additional notes:
Furniture [will be moved by me before arrival / needs to be moved as part of the job]. [Note any height transition challenges — e.g., doorways, adjoining rooms with different flooring]. Please include all flooring materials, underlayment, adhesive, transitions, and labor in your bid.`,

  'Roofing': (title) => `I need a licensed roofing contractor to help with: ${title}.

Roof details:
Roof type: [shingle / tile / metal / flat/TPO]. Approximate roof age: [years]. Last inspected or repaired: [when]. Home is a [single-story / two-story] structure with a roof area of approximately [sq ft, or leave for contractor to assess].

Problem description:
[Describe the issue — e.g., active leak during rainstorms, ceiling water stain in master bedroom closet, several shingles are visibly missing or lifted, flashing around chimney is deteriorating, flat roof has standing water]. The leak appears to be coming from [area of roof — front / rear / valley / ridge / around a vent pipe].

Scope of work:
I need: [emergency roof repair / replace missing/damaged shingles / re-flashing / full roof inspection / full replacement quote]. Florida consideration: [previous hurricane damage, wind mitigation may need to be updated]. [Note if insurance claim is involved — yes / no / in progress].

Access & additional notes:
[Note any access restrictions — HOA approval required, tall trees near roofline, steep pitch]. I would like a detailed written estimate before any work begins. Please include all materials (shingles/tiles/underlayment/flashing), labor, and debris removal in your bid.`,

  'Drywall': (title) => `I need a drywall professional to help with: ${title}.

Damage description:
[Describe the damage — e.g., fist-sized hole from a doorknob, 3 × 4 ft water-damaged section from a roof leak, stress cracks running from window corners, popped nails creating bumps across the ceiling, texture is peeling in the bathroom].

Number and size of repairs:
[List each area — e.g.:
- Hallway: one 6-inch hole
- Master bedroom: 2 × 2 ft section with water staining
- Kitchen ceiling: hairline cracks approximately 3 ft long]

Scope of work:
I need: [patch and texture match / full drywall replacement for a section / skim coat to smooth imperfections / ceiling repair]. The existing texture is: [smooth / orange peel / knockdown / popcorn — please match existing]. The repaired area will need to be [left primed for me to paint / painted to match — current wall color is _____].

Access & additional notes:
[Note the cause of any water damage — has the source been fixed? Leak from roof / plumbing — repaired on [date]]. The affected rooms are [interior / bathroom with moisture — mold-resistant drywall may be needed]. Please include all patching compound, mesh, tape, and texture materials in your bid.`,

  'Stucco Cracks and Repairs': (title) => `I need a stucco repair specialist to help with: ${title}.

Damage description:
[Describe the cracks or damage — e.g., hairline cracks in an exterior wall, larger diagonal cracks around window corners (possible structural settling), chunks of stucco separating from the substrate, discoloration and bubbling suggesting moisture intrusion].

Location and extent:
The damage is located on the [front / rear / north / south] exterior wall of my home. Total affected area: approximately [number] sq ft or [number] linear feet of cracks. The stucco finish is: [smooth / sand / dash / medium texture — please match].

Scope of work:
I need: [hairline crack routing and sealing / spot patch and texture match / full section replacement / waterproofing coat application]. [Note if this is storm-related or a recurring issue]. The home exterior is currently painted in [color — e.g., off-white / beige / gray].

Access & additional notes:
[Note if scaffolding or a lift will be needed — second-story walls, soffit area]. HOA requires [color match approval — yes / no]. Florida consideration: the repair should use exterior-grade, elastomeric or acrylic stucco mix to handle heat and humidity. Please include all materials and labor, and advise if waterproof membrane is recommended.`,

  'Pool Maintenance & Repair': (title) => `I need a pool service professional to help with: ${title}.

Pool details:
Pool type: [inground gunite / fiberglass / above-ground vinyl]. Approximate size: [length × width] ft, [depth] ft deep. Equipment: [brand/model of pump, filter, and heater if known]. Pool [has / does not have] a spa/hot tub attached.

Problem description:
[Describe the issue — e.g., pump is making loud noise and not circulating water, pool water is green and algae-covered after a storm, filter pressure is consistently high, pool is losing [X] inches of water per day suggesting a leak, pool light is not working, tile is cracked along the waterline].

Current chemical levels (if known):
pH: [___], Free Chlorine: [___], Alkalinity: [___]. Last professionally serviced: [when]. I currently [use a regular pool service / handle chemicals myself / pool has been neglected for a period].

Scope of work:
I need: [one-time clean-up and chemical balance / equipment diagnostic and repair / leak detection / tile replacement / equipment replacement]. [Note if this is emergency service — e.g., party in [X] days]. Please include all chemicals, parts, and labor in your bid.`,

  'Screen Enclosures': (title) => `I need a screen enclosure specialist to help with: ${title}.

Enclosure details:
Screen enclosure type: [pool cage / lanai / Florida room / porch enclosure]. Approximate dimensions: [length × width] ft. Frame material: [aluminum / steel]. Screen mesh type (if known): [standard fiberglass / solar screen / no-see-um mesh].

Damage description:
[Describe the damage — e.g., 4 screen panels are torn from a recent storm, one section of aluminum frame is bent and pulling away from the roof, door latch is broken and door won't stay closed, corrosion on lower frame sections near pool water].

Number of panels affected:
[Estimate the number of torn/damaged panels — e.g., 3 small panels + 1 large roof panel]. [Note if the frame itself is damaged or just the screening material]. The damage [was / was not] caused by a named storm — [insurance may / may not be involved].

Scope of work:
I need: [screen re-mesh on damaged panels / frame repair / full section replacement / door hardware replacement]. Screen preference: [match existing / upgrade to solar screen for shade / upgrade to no-see-um mesh]. Please include all screen material, framing, hardware, and labor in your bid. Please advise if a permit is required for the scope of repairs.`,

  'Pressure Washing': (title) => `I need a pressure washing professional to help with: ${title}.

Surfaces to be cleaned:
[Check all that apply and add square footage where known:
- Driveway: approximately [length × width] ft
- Sidewalk/walkway: approximately [linear ft]
- Pool deck: approximately [sq ft]
- Exterior walls/stucco: [sq ft]
- Roof (soft wash only): [sq ft]
- Patio/lanai pavers: [sq ft]
- Fence/walls: [linear ft]]

Current condition:
[Describe the buildup — e.g., driveway has significant mildew staining and tire marks, pool deck has algae growth and is slippery, exterior walls show green/black algae streaks, roof has lichen and organic staining]. Last professionally cleaned: [date or "never in [X] years"].

Special considerations:
[Note any delicate surfaces — e.g., older painted surfaces, decorative pavers, window seals that may need protection]. Florida note: there is [a lot of / moderate / minimal] organic growth due to our humidity and heat.

Scope of work:
I need [hot / cold] water pressure washing [or soft wash for roof/painted surfaces]. [Note if biodegradable/pet-safe detergents are required]. Please provide a flat rate for the surfaces listed above. I would like before/after photos upon completion.`,

  'Hurricane Shutters & Storm Prep': (title) => `I need a hurricane preparedness specialist to help with: ${title}.

Property details:
Home type: [single-family / townhome / condo]. Number of windows and doors to be protected: approximately [number of openings]. Current protection: [accordion shutters / panel shutters / impact windows (some) / no protection currently].

Scope of work:
[Describe what is needed — e.g., install new accordion shutters on 12 windows and 2 glass doors, repair jammed accordion shutters on the south side, install hurricane fabric panels, replace corroded panel hardware, assess and upgrade protection to meet current Miami-Dade/Broward County code].

Product preferences:
[Note any preferences — e.g., prefer accordion shutters for ease of use, interested in hurricane fabric as an alternative, would like impact-rated options for insurance discount eligibility]. My current insurance provider [does / does not] offer a discount for wind mitigation upgrades.

Permit & compliance:
The installation [does / does not / I'm unsure] require a building permit. I [have / do not have] an existing wind mitigation inspection report. Please advise on current Florida building code compliance and include all hardware, installation, and permit fees in your bid.`,

  'Termite Infestations': (title) => `I need a licensed pest control professional to help with: ${title}.

Signs of infestation:
[Describe what you've observed — e.g., small mud tubes on the foundation or interior walls, discarded wings near window sills after a swarm, hollow-sounding wood when tapped, visible frass (wood dust) below baseboards, actual termite sightings — describe where]. The infestation appears to be [localized to one area / widespread throughout the home].

Affected areas:
[List locations — e.g., garage walls, back bedroom closet, front porch/exterior wood trim, attic/roof line, floor joists in crawl space]. Approximate extent: [small and localized / moderate / extensive — multiple rooms/areas].

Home details:
Home was built in [year]. Construction type: [wood frame / CBS block with wood interior / slab foundation]. Last termite treatment: [date / never / unknown — bought the home in [year]]. Current protection plan: [active Orkin/Terminix bond / no current plan].

Scope of work:
I need: [termite inspection and report / spot treatment / liquid barrier treatment / bait station system installation / tent fumigation estimate / structural repair assessment after treatment]. Please include your license number and warranty terms in your bid. Florida Wood-Destroying Organism (WDO) report [is / is not] required for my purposes.`,
};

/**
 * Simulate an AI generation delay (1.2–1.8 s) and return a category-specific
 * description draft personalised with the job title.
 */
export async function generateJobDescription(
  title: string,
  category: string,
): Promise<GeneratedDescription> {
  // Simulate network + model latency
  const delay = 1200 + Math.random() * 600;
  await new Promise(resolve => setTimeout(resolve, delay));

  const factory = templates[category as JobCategory];
  if (!factory) {
    // Fallback for unknown category
    const text =
      `I need professional help with: ${title}.\n\n` +
      `Problem description:\n[Describe the issue in detail — when it started, what you've observed, and any steps you've already tried.]\n\n` +
      `Scope of work:\n[List exactly what needs to be done. Include measurements, materials, or special requirements.]\n\n` +
      `Access & additional notes:\n[Describe access requirements, scheduling preferences, and any other relevant details. Include whether materials should be supplied by the handyman.]`;
    return { text };
  }

  return { text: factory(title.trim()) };
}
