# F3 fire-response formula spec

**Version:** 1.0 · **Status:** Draft, frozen once Mark signs off ·
**Drafted:** October 12, 2026 · **Owner:** Mark Luis Barican

This document defines how Hydro-Scout turns a pinned fire into a hose length
and a fire-truck count, and the exact result object the fire panel receives.
The formula is implemented by `estimateSupplyLine` in `lib/supply-line.ts`,
the route lookup by `fetchHoseRoute` in `lib/route-distance.ts`, and the
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
| `version` | `2026-10-12` | Set when values change |
| `hosePerTruck` | 10 sections of 100 ft (30.48 m) and 10 sections of 50 ft (15.24 m) | Team decision, Mark, October 12, 2026. To be confirmed with BFP |
| `maxPumpDistanceM` | not set | Optional pressure limit. To be supplied by BFP |
| `layoutFactor` | 1.3 | Same detour factor the nearest-hydrant search already uses (`lib/nearest-hydrant.ts`). Not field-verified |
| `hydrantSearchRadiusM` | 500 | Existing value in `lib/fire-response.ts` |

One truck therefore carries 10 × 30.48 m + 10 × 15.24 m = **457.2 m**
(1,500 ft) of hose.

## Formula

### Step 1: hose length `L`

`L` is the distance the hose must cover from the hydrant to the fire, in whole
metres. The app tries three sources in order and records which one it used.

1. **Mapbox Directions, walking profile.** Hose is not bound by one-way
   streets and can run through alleys, so the walking route is used.
2. **OSRM**, if Mapbox has no token, returns an error, times out, or finds no
   route. The public OSRM server answers every profile with its driving
   route (checked October 12, 2026), so this distance can be longer than the
   walking route.
3. **Straight line × `layoutFactor`**, if both routing services fail.

For sources 1 and 2, routing services start and end the route on the nearest
mapped path. The straight-line gap from the hydrant to the start of the route,
and from the end of the route to the fire, is added to the route distance.

`L` = the resulting distance, rounded to the nearest metre.

### Step 2: stage length `S`

A stage is the longest stretch one pumper can cover. A pumper cannot push
water farther than the hose it carries, and a pressure limit can shorten that.

`S` = the smaller of the hose one truck carries (457.2 m) and
`maxPumpDistanceM`. While `maxPumpDistanceM` is not set, `S` = 457.2 m.

### Step 3: truck count

| Truck | Count | Rule |
| --- | --- | --- |
| Engine at the fire | 1 | Always. It fights the fire and keeps its own hose for attack lines |
| Pumper at the hydrant | 1 | Always. It pushes water through the first stage |
| Relay pumpers | `ceil(L / S) − 1`, never below 0 | One more each time the line outgrows another stage |

`fireTrucks` = engine at the fire + pumper at the hydrant + relay pumpers
= `1 + max(1, ceil(L / S))`.

The smallest possible answer is 2 trucks.

### Step 4: hose sections

The supply line uses the hose carried by the pumper at the hydrant and the
relay pumpers. The engine at the fire does not contribute hose.

1. Take the hose sizes longest first. For each size, use as many whole
   sections as fit in the length still to cover, up to the number available.
2. If some length is still uncovered, add one more section of the shortest
   size that is still available.
3. If `L` is 0, use one section of the shortest size.

`hoseSections` is the total number of sections used. The laid length is the
sum of those sections and is always at least `L`.

## Worked examples

All examples use the config values above (`S` = 457.2 m). They are the test
cases in `test/supply-line.test.mjs`; a change to the config values means
updating both.

| # | Case | `L` | Trucks: fire + hydrant + relay | 100 ft | 50 ft | Sections | Laid length |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Nearby hydrant | 100 m | 1 + 1 + 0 = **2** | 3 | 1 | 4 | 107 m |
| 2 | Typical lay | 320 m | 1 + 1 + 0 = **2** | 10 | 1 | 11 | 320 m |
| 3 | Just inside one stage | 457 m | 1 + 1 + 0 = **2** | 10 | 10 | 20 | 457 m |
| 4 | Just over one stage | 458 m | 1 + 1 + 1 = **3** | 15 | 1 | 16 | 472 m |
| 5 | Long lay | 650 m | 1 + 1 + 1 = **3** | 20 | 3 | 23 | 655 m |
| 6 | Routing failed, 250 m straight-line × 1.3 | 325 m | 1 + 1 + 0 = **2** | 10 | 2 | 12 | 335 m |
| 7 | Fire at the hydrant | 0 m | 1 + 1 + 0 = **2** | 0 | 1 | 1 | 15 m |

Example 4 in full: 458 m is longer than one 457.2 m stage, so
`ceil(458 / 457.2)` = 2 supply pumpers, which is 1 at the hydrant and 1 relay.
Those two pumpers carry 20 sections of each size. Fifteen 100 ft sections
cover 457.2 m; the remaining 0.8 m takes one 50 ft section.

## Output format

This is the object the fire panel receives.

```ts
type SupplyLineEstimate =
  | { status: 'pending'; missing: string[] }
  | {
      status: 'ready';
      hoseLengthM: number;
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
        source: 'mapbox' | 'osrm' | 'straight-line';
        straightLineM: number;
      };
      configVersion: string;
    };
```

| Field | Meaning |
| --- | --- |
| `status` | `ready` when the numbers are valid. `pending` when a required config value is missing; `missing` names the keys |
| `hoseLengthM` | `L` from step 1, whole metres |
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
- The walking route is the best available stand-in for the real hose path. It
  can include paths a hose cannot follow, such as stairs or footbridges.
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

## Automated checks

```powershell
node --test test/supply-line.test.mjs test/route-distance.test.mjs
npx.cmd tsc --noEmit --incremental false
```

Use Node 24, which runs the TypeScript imports in the tests directly.
