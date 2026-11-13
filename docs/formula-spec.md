# F3 fire-response formula spec

**Version:** 1.2 · **Status:** Draft, frozen once Mark signs off ·
**Drafted:** October 12, 2026 · **Revised:** November 11, 2026 ·
**Owner:** Mark Luis Barican

This document defines how Hydro-Scout turns a pinned fire into a hose length
and a fire-truck count, and the exact result object the fire panel receives.
The formula is implemented by `estimateSupplyLine` in `lib/supply-line.ts`,
the route lookup by `fetchHoseRoute` in `lib/route-distance.ts` (with the
street-network path from `fetchStreetPath` in `lib/hose-network.ts`), and the
result is shown by `app/src/components/FireResponsePanel.tsx`.

## What the result means

The result is the minimum number of fire trucks, and the hose sections, needed
to run **one continuous supply line** from one hydrant to the fire. It is not a
full alarm assignment: ladder trucks, rescue units, tankers and extra attack
crews are outside this formula.

## Inputs

| Input | Meaning | Where it comes from |
| --- | --- | --- |
| Fire location | Latitude and longitude of the pinned fire | Responder pins it on the map |
| Supply hydrant | The hydrant the line starts from | Responder's pick; otherwise the nearest operational hydrant within the search radius, otherwise the nearest of any status |
| Config | The values in the next section | The config file |

## Config values

The formula reads every number below from one config file,
`lib/fire-response.config.ts`. Changing a value changes the results without
changing the formula; each change bumps `version`.

| Key | Value | Source |
| --- | --- | --- |
| `version` | `2026-11-07` | Set when values change |
| `hosePerTruck` | 3 sections of 50 ft (15.24 m); 100-ft hose is not used | BFP update, November 7, 2026 |
| `maxPumpDistanceM` | 45.72 m (150 ft) | BFP update: add one relay engine for each additional 150-ft stage |
| `layoutFactor` | 1.3 | Same detour factor the nearest-hydrant search already uses (`lib/nearest-hydrant.ts`). Not field-verified |
| `hydrantSearchRadiusM` | 1,000 m | BFP update; expand in 500-m bands only when no hydrant is found |

Each supply stage uses three 50-ft sections: **45.72 m (150 ft)**. The initial
pumper serves the first stage; each additional stage adds one relay engine.

## Formula

### Step 1: hose length `L`

`L` is the distance the supply hose must cover from the hydrant to where the
engine at the fire parks, in whole metres. The app tries three sources in order and records which one it used.

1. **Street network** (`streets`). The shortest path along the mapped
   streets and paths, found by the app itself from OpenStreetMap data (the
   OpenFreeMap vector tiles the map already uses). A hose is not traffic, so
   every street is open in both directions, and residents-only streets and
   gates are passed through. Motorways, rail lines, ferries, cable cars, race
   tracks and indoor paths are left out. Streets that meet are joined where
   the map joins them, where one ends within 2.5 m of another, and where two
   ground-level streets cross; a bridge or tunnel joins only at its ends.

   Trucks only stand on streets. The supply line (every truck in it) runs
   on streets only; footpaths, steps, walkways, tracks, piers, roads under
   construction, and service driveways, parking aisles, alleys and car-park
   ramps (service roads in a tunnel or on a bridge) are left to the attack
   line. The engine at the fire parks where the supply line ends: either
   where the path to the fire leaves the streets, or at any street point
   within 100 m of the fire, from where its attack line runs straight in.
   When choosing, each metre of attack line counts as 10 metres of supply
   line (`ATTACK_LINE_WEIGHT` in `lib/hose-network.ts`): the engine drives as
   close as the streets allow unless that takes a detour more than ten times
   the hose it saves.
2. **Mapbox Directions, walking profile** (`mapbox`), if the street network
   cannot be loaded, times out, or has no connected path. It is requested at
   the same time as source 1. Walking directions ignore one-way streets but
   avoid gates and residents-only streets, so this distance can be longer.
3. **Straight line × `layoutFactor`**, if both fail.

Routing services do not offer a way to pass gates: Mapbox walking, OSRM and
Valhalla (with its `ignore_access` and `ignore_oneways` options) all routed
around the gated part of Malumanay Street, Teachers Village, in a check on
October 22, 2026 (HYD-017 to 14.64539, 121.05491: 461 m around the block
against 338 m down the street). That is why source 1 exists.

For sources 1 and 2, the route starts on the nearest street (source 1) or
mapped path (source 2). The straight-line gap from the hydrant to the start
of the route is added to the route distance. The distance from where the
engine parks to the fire (a fire inside a building or a lot) is the **attack
line** `A`: for source 1, any walkways past the street plus the straight gap
to the fire; for source 2, the straight gap from the end of the route. The
engine covers it with its own hose, so it is not part of `L` and no truck is
placed on it.

`L` = the resulting distance, rounded to the nearest metre.
`A` = the attack line, rounded to the nearest metre; 0 for source 3.

### Step 2: stage length `S`

A stage is the longest stretch one pumper can cover. A pumper cannot push
water farther than the hose it carries, and a pressure limit can shorten that.

`S` = **45.72 m (150 ft)**. This is the BFP relay-engine interval.

### Step 3: truck count

| Truck | Count | Rule |
| --- | --- | --- |
| Engine at the fire | 1 | Always. It fights the fire and keeps its own hose for attack lines |
| Relay/spotter at the hydrant | 1 | Always. It hooks up to the hydrant as the spotter and pushes water through the first stage, so it is also the first relay |
| Relay engines | `ceil(L / S) − 1`, never below 0 | One more each time the line outgrows another 150-ft stage |

`fireTrucks` = engine at the fire + relay/spotter at the hydrant + relay engines
= `1 + max(1, ceil(L / S))`.

The smallest possible answer is 2 trucks.

### Step 4: hose sections

The supply line uses only 50-ft hose carried by the relay/spotter at the hydrant and
the relay engines. The engine at the fire does not contribute hose.

1. Take the hose sizes longest first. For each size, use as many whole
   sections as fit in the length still to cover, up to the number available.
2. If some length is still uncovered, add one more section of the shortest
   size that is still available.
3. If `L` is 0, use one section of the shortest size.

`hoseSections` is the total number of sections used. The laid length is the
sum of those sections and is always at least `L`.

## Worked examples

All examples use the config values above (`S` = 45.72 m). They are the test
cases in `test/supply-line.test.mjs`; a change to the config values means
updating both.

| # | Case | `L` | Trucks: fire + hydrant + relay | 50 ft | Sections | Laid length |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Nearby hydrant | 45 m | 1 + 1 + 0 = **2** | 3 | 3 | 46 m |
| 2 | First relay engine | 46 m | 1 + 1 + 1 = **3** | 4 | 4 | 61 m |
| 3 | Typical lay | 320 m | 1 + 1 + 6 = **8** | 21 | 21 | 320 m |
| 4 | Long lay | 650 m | 1 + 1 + 14 = **16** | 43 | 43 | 655 m |
| 5 | Routing failed, 250 m straight-line × 1.3 | 325 m | 1 + 1 + 7 = **9** | 22 | 22 | 335 m |
| 6 | Fire at the hydrant | 0 m | 1 + 1 + 0 = **2** | 1 | 1 | 15 m |

Example 2 in full: 46 m is longer than one 45.72 m stage, so
`ceil(46 / 45.72)` = 2 supply engines: one at the hydrant and one relay
engine. Four 50-ft sections cover the 46 m line.

## Output format

This is the object the fire panel receives.

```ts
type SupplyLineEstimate =
  | { status: 'pending'; missing: string[] }
  | {
      status: 'ready';
      hoseLengthM: number;
      attackLineM: number;
      hoseSections: number;
      fireTrucks: number;
      trucks: {
        engineAtFire: number;
        pumperAtHydrant: number;
        relayPumpers: number;
      };
      hose: {
        sections: { lengthFt: number; count: number }[];
        laidLengthM: number;
      };
      stageLengthM: number;
      distance: {
        source: 'streets' | 'mapbox' | 'straight-line';
        straightLineM: number;
      };
      configVersion: string;
    };
```

| Field | Meaning |
| --- | --- |
| `status` | `ready` when the numbers are valid. `pending` when a required config value is missing; `missing` names the keys |
| `hoseLengthM` | `L` from step 1, whole metres |
| `attackLineM` | `A` from step 1, whole metres: from where the engine parks to the fire |
| `hoseSections` | Total sections from step 4 |
| `fireTrucks` | Total trucks from step 3 |
| `trucks` | The three counts that add up to `fireTrucks` |
| `hose.sections` | Sections used per hose size, longest first. Sizes with a count of 0 are included |
| `hose.laidLengthM` | Combined length of the sections used, whole metres |
| `stageLengthM` | `S` from step 2, to one decimal place |
| `distance.source` | Which source in step 1 produced `L` |
| `distance.straightLineM` | Straight-line distance from hydrant to fire, whole metres |
| `configVersion` | `version` of the config used |

`hoseLengthM`, `hoseSections` and `fireTrucks` keep the names and meanings the
panel already uses.

While a route request is still in flight, the panel receives a provisional
result with `distance.source` set to `straight-line`. It is replaced when the
route arrives. A result whose source is `straight-line` should be shown as an
estimate.

`maxPumpDistanceM` is optional, so leaving it unset does not make the result
`pending`.

## Assumptions and limits

- Every truck carries the same hose load.
- Stage length is limited only by hose carried until BFP supplies a pressure
  limit. Friction loss, pump pressure and flow rate are not modelled.
- Hydrant pressure and flow are not modelled. A hydrant that is not
  operational still produces a result; the panel warns about its status.
- Elevation between the hydrant and the fire is ignored.
- The street-network path is the best available stand-in for the real hose
  path. It can include paths a hose cannot follow, such as stairs or
  footbridges, and gates that are locked. It cannot cut across lots or
  through buildings that have no mapped path.
- One supply line from one hydrant. Several lines or several hydrants feeding
  the same fire are not modelled.

## What is frozen

Once signed off, these do not change without a new spec version and team
agreement:

- the steps of the formula and the counting rule in step 3;
- the names, types and meanings of the output fields above.

These can change without a new spec version:

- config values, with a new `version`;
- new output fields added alongside the existing ones;
- how the panel presents the result.

## Open items

1. Confirm the hose load per truck with BFP.
2. Obtain a pressure limit for `maxPumpDistanceM` from BFP, or confirm that the
   hose-carried limit is acceptable.
3. Confirm or replace the 1.3 `layoutFactor`. In one live check on October 12,
   2026, the routed distance from hydrant HYD-001 to a test point was 679 m
   against 319 m in a straight line, a factor of 2.1. With 1.3 the fallback
   gave 414 m and 2 trucks where the route gave 3.

## Changes

- **1.1, October 22, 2026.** Step 1: the street-network path (`streets`)
  replaces Mapbox walking as the first source, Mapbox walking moves to second,
  and OSRM is removed because its public server only routes by car and obeys
  one-way streets. `distance.source` becomes
  `'streets' | 'mapbox' | 'straight-line'`. Needs Mark's sign-off.

- **1.2, November 11, 2026.** Step 1: no truck is placed off the street.
  The supply line runs on streets only and ends where the engine at the
  fire parks; walkways, driveways, parking aisles, alleys and the gap into a
  building are the engine's attack line, which is not part of `L`. A fire
  inside a building used to put trucks along walkways and driveways into
  it. New output field `attackLineM`. Requested by the team on November 11,
  2026; needs Mark's sign-off.

## Automated checks

```powershell
node --test test/supply-line.test.mjs test/route-distance.test.mjs test/hose-network.test.mjs
npx.cmd tsc --noEmit --incremental false
```

Use Node 24, which runs the TypeScript imports in the tests directly.
