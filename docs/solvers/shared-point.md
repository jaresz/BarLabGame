# Shared Positional Points

Version 0.5.0 replaces iterated zero-length welds with one shared translational degree of freedom in both Basic XPBD and Serpentine. Connected beam and rope endpoints use exactly the same position and velocity. Their material mass contributions are summed. Hinges share translation too; their relative angles remain free. Clamped and pinned supports retain their existing positional and angular rules.

## Representation and fracture

Each member keeps its contiguous rendering samples and its two visible halves. `World.particleIds` maps those samples to one physical representative. Only representatives are integrated under gravity, corrected by constraints and checked for collisions. Samples are synchronized afterwards for damage measurements, audio and rendering. `mass` stores individual material contributions; `invMass` is the inverse of the total incident mass, or zero for a support. The frame's point count reports active physical representatives; frame buffers retain their original per-member layout.

Length constraints access representatives directly. Angular constraints sum all gradient contributions for a repeated physical ID **before** forming the mass-weighted squared gradient. This matters both for adjacent segments and for several members meeting at a rigid joint. Translational weld constraints are eliminated rather than assigned an increased stiffness or more iterations.

An intact member midpoint also shares one representative. When the normal strain/curvature damage test breaks the member, its reserved right-half midpoint sample becomes an independent particle. The two tips retain their positions and velocities and recover their separate material mass contributions. This creates no impulse and conserves total mass and linear momentum at the split. Endpoint attachments remain intact. Cable crossings and coincident interiors without an explicit shared endpoint remain disconnected.

Gravity 9.81, DT = 1/120 s, 12 sweeps, damping, all profiles, breaking thresholds, perturbation ±0.001, format 4 and example geometry are unchanged. There is no cable pretension or example-specific physics.

## Twenty-second comparison

The measurements describe the solver released as 0.5.0. Report metadata uses this release version consistently with the application and exported projects.

Every project was measured with Basic XPBD, Serpentine left and Serpentine right, each with both disturbance signs. Every particle is checked at initialization and after every step. Acceptance requires finite positions/velocities, no fracture, peak displacement ≤2.5 units relative to the original design, stationary supports and no new boundary contacts.

Peak displacement below is the worst of six complete runs, in board units. The current small Seri Wawasan now passes all six runs without an acceptance exception.

| Example | Before (0.4.79) | Shared points (0.5.0) | Passing runs after |
| --- | ---: | ---: | ---: |
| Ponte Luís I | 1.108 | 0.441 | 6 / 6 |
| RTCN Kołowo | 1.625 | 0.922 | 6 / 6 |
| Seri Wawasan (24 × 14) | 3.392 | 2.138 | 6 / 6 |
| Golden Gate | 1.189 | 1.005 | 6 / 6 |
| Starter bridge | 7.624 | 4.113 | 0 / 6 |
| Eiffel Tower | 1.019 | 0.353 | 6 / 6 |
| Sydney Harbour | 1.230 | 0.540 | 6 / 6 |

All current gallery runs remained finite and all supports exactly stationary. The six landmark examples other than the starter bridge have no fractures or new boundary contacts in any run. The starter bridge also loses its earlier fractures and contacts, but still exceeds the displacement threshold; it is not advertised as meeting the stricter landmark criterion.

Raw results: [four-example baseline](../examples/shared-joints-baseline.json), [four-example current report](../examples/measurements.json), and [remaining three examples before/after](../examples/shared-joints-other-examples.json). No gallery geometry was changed to obtain these results.

## Larger Seri Wawasan remains outside the gallery

The three saved 48 × 32 candidates were rerun for all 18 full trajectories. Shared points improve some trajectories considerably, but none passes all criteria. The wider lattice survives Basic XPBD and right-start Serpentine without fractures or boundary contacts (four runs), but exceeds 2.5 units and still fractures with a left start. It must not replace the accepted small example.

| Candidate | Peak before | Peak after | Fracture-free runs after | Passing runs after |
| --- | ---: | ---: | ---: | ---: |
| fork-standard-front | 25.135 | 24.949 | 0 / 6 | 0 / 6 |
| fork-heavy-front | 25.021 | 25.073 | 0 / 6 | 0 / 6 |
| wide-lattice | 25.445 | 24.170 | 4 / 6 | 0 / 6 |

[Current candidate measurements](../examples/seri-wawasan-large/measurements.json) and [the separate-particle baseline](../examples/seri-wawasan-large/separate-particles-baseline.json) retain the complete trajectories' metrics. The original [geometry report and historical joint-gap diagnosis](../examples/seri-wawasan-large/README.md) explain their construction.

## Limits and verification

Exact translational joints remove artificial joint opening. Elastic segment constraints and angular joints are still solved locally with finite iterations, so ordering, residual numerical compliance and symmetry sensitivity remain. Shared positions are not a general stability proof. Historical tower animations and their numeric offsets predate this change and are retained with explicit historical labels; the current engine must not be expected to reproduce them.

Physics regressions check summed unequal beam/rope masses, single gravity integration, hinges, exact sample coincidence after corrections, numerical differentiation of the shared-endpoint angular gradient, disconnected crossings, and beam/rope fracture separation with mass and momentum conservation. Existing elasticity, tension-only cable, support, sound, import/export and browser checks remain in place. All four monitored examples now require the full stability criteria in `tests/landmarks.test.ts`.

Reproduce current acceptance reports and release checks:

```powershell
node --import tsx scripts/measure-landmarks.ts
node --import tsx scripts/measure-seri-wawasan.ts
npm test
$env:FRAME_LAB_CHROMIUM = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:browser
```

Historical before-values remain saved data; rerunning a current-engine script does not recreate the old solver.
