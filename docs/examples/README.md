# Landmark Examples

The proposed larger Seri Wawasan replacement was screened separately. None of the saved 48 × 32 candidates passed all stability criteria, so the gallery keeps the current design. See the [larger-design trials, actual geometry and full measurements](seri-wawasan-large/README.md).

The gallery includes 2D interpretations of real structures. These are recognizable silhouettes using the game's existing beam sections and tension-only ropes, not engineering replicas or models at a fixed real-world scale. Gallery thumbnails draw the exact normalized geometry loaded into the editor.

## Ponte Luís I

The 24 × 16 board contains two decks, a double-chord lattice arch, upper-deck posts and lower-deck hangers. The side boundaries represent the rock abutments: there are no interior piers or hidden supports. Heavy sections stiffen the arch and both decks. The proportions and lattice are simplified, and long posts are split at integer-grid joints to respect the existing six-unit beam limit.

The inspiration is the two-deck metal bridge between Porto and Vila Nova de Gaia, described by [Infraestruturas de Portugal](https://servicos.infraestruturasdeportugal.pt/pt-pt/node/6542).

## RTCN Kołowo

The 28 × 20 board shows two lattice masts with different heights, triangular bracing, and multiple guy ropes. The tall mast is 16 units high and the smaller one six: their height ratio and the spacing of the masts are compressed for a readable 2D view. The existing Heavy section is used for the mast legs; Standard sections form the lattice.

The mast bases meet the bottom boundary. Four visible, two-unit-high triangular anchor frames transfer guy loads to pairs of ground supports and give sagging ropes clearance above the ground. These raised frames are an explicit gameplay simplification of the guy foundations, not a reproduction of the site's foundations. Each upper guy is now a single rope member between the same mast and anchor endpoints; the redundant editor joint has been removed. Kołowo contains six rope members.

The reference is the pair of masts listed in [Emitel's infrastructure information](https://emitel.lifemotion.pl/wp-content/uploads/20180425_INFORMACJE_W_SPRAWIE_DOSTEPU_TELEWIZJA_FIN.pdf); [RadioPolska's Kołowo record and photographs](https://radiopolska.pl/wykaz/obiekt/91) provide additional visual context. This example represents the pair of transmitting masts rather than two identical freestanding towers.

## Seri Wawasan Bridge

The 24 × 14 board uses a forward-inclined lattice pylon, a shallow triangulated deck representing a box girder, a backstay and a fan of forward stays. Side boundaries represent the banks, and the pylon legs reach the bottom boundary. All five stays are single rope members, including the longer outer stays. The backstay uses Heavy rope. Seven visible Heavy braces spread pylon loads into the existing deck and the same foundations; no boundary support was added. Every rope remains tension-only and no rope member exceeds twenty units.

The real bridge's asymmetric cable-stayed design and inclined pylon are described in [CIDB's Beautiful Bridges](https://www.cidb.gov.my/wp-content/uploads/2022/11/CIDB-full-layout-12.54pm-lowres_compressed.pdf). The game's lattice pylon and deepened deck deliberately simplify the real structure's materials and cross-sections.

Since version 0.5.0, this example **meets the full stability criteria in all six runs**. Shared translational particles reduce the worst displacement from 3.393 to 2.138 units and eliminate the two left-start rope fractures, with no new boundary contacts. Its geometry and material profiles are unchanged. See the [shared-point comparison](../solvers/shared-point.md).

## Golden Gate Bridge

The original 32 × 18 geometry, curve-defining cable segments, hanger attachments and supports are unchanged. Main-cable segments use Heavy rope; vertical hangers remain Standard to avoid unnecessary suspended mass. All beams use the existing Heavy section. The peak displacement falls from 1.343 units before Heavy reinforcement to 1.190 in 0.4.79, then to 1.005 with shared particles in 0.5.0, with no breaks or new boundary contacts in any of the six runs.

## Rope profiles and limitations

Heavy models four times the rope cross-sectional area: line density rises from 0.22 to 0.88, axial rigidity from 80,000 to 320,000, price from 2 to 8 credits/unit, and rendered diameter doubles. The same 10% tensile-strain damage threshold and 0.05-second overload duration apply to both profiles. This is an area increase, not an extra ductility allowance. Both types remain flexible and tension-only, and both have a twenty-unit editor length limit. A long member still contains physical particles; changing editor segmentation can change the numerical trajectory. Older saves import as Standard without automatic upgrades.

## Twenty-second checks

All runs use the same physics as normal play: gravity 9.81, 12 iterations per 1/120-second step, profile-specific mass/stiffness and unchanged breaking parameters, and the controlled initial horizontal imperfection. Since version 0.4.78, the global rope length limit is 20 units; the beam limit remains six. Standard material properties are unchanged; Heavy is an explicit additional section. Version 0.5.0 improves joint translation by using a shared physical particle rather than iterated endpoint weld constraints.

Each example is tested with Basic XPBD, Serpentine starting left, and Serpentine starting right. Every schedule is run separately with perturbation amplitude +0.001 and −0.001, making six trajectories per example (24 trajectories total). Every particle is checked at initialization and after each of 2,400 steps, including interiors of beams and ropes.

Stability requires no broken members at any time, a maximum displacement of at most 2.5 board units relative to the unperturbed design, exactly stationary support particles, and no new contacts with any board edge. Initial boundary contacts at foundations and abutments are allowed. The contact count in the raw report counts particle/step samples, not distinct particles or impacts.

| Example | Stable in all six runs | Peak displacement across runs | Breaking and boundary contacts |
| --- | --- | ---: | --- |
| Ponte Luís I | Yes | 0.442 units or less | No breaks or new contacts |
| RTCN Kołowo | Yes | 0.923 units or less | No breaks or new contacts |
| Golden Gate Bridge | Yes | 1.005 units or less | No breaks or new contacts |
| Seri Wawasan Bridge | Yes | 2.138 units or less | No breaks or new contacts |

The values describe the shared-particle solver released as version 0.5.0. The report metadata uses the same release version. Exact results for each schedule and disturbance sign are stored in [measurements.json](measurements.json). No support particle moved in any run. All four examples meet all criteria. The previous shared-point-free measurements are preserved in [shared-joints-baseline.json](shared-joints-baseline.json), and the original bridge measurements and format-3 designs in [rope-baseline.json](rope-baseline.json).

Reproduce the report from the project root:

```powershell
node --import tsx scripts/measure-landmarks.ts
```

`npm test` independently runs the same full checks for all four examples. There is no longer an exception allowing Seri Wawasan to fracture or exceed 2.5 units. The browser suite checks all eight gallery cards, actual thumbnail geometry, canvas dimensions, simulation startup, JSON round trips, Undo, and access on desktop and mobile.

## Historical reinforcement trials (before shared particles)

The measurements and pretension proposal below predate 0.5.0. Shared translational points subsequently stabilized the existing small example without pretension. The larger candidates still fail acceptance; see the [current solver report](../solvers/shared-point.md).

Trials used the normal 12 iterations and gravity 9.81. The following exploratory positive-perturbation, right-start Serpentine trajectories were measured for the full twenty seconds (these are not the complete six-variant acceptance matrix):

| Seri Wawasan trial | Peak displacement | First break | New boundary contacts |
| --- | ---: | ---: | --- |
| Original geometry, every rope Heavy | 9.133 | 1.125 s | Yes |
| Original geometry, every beam and rope Heavy | 9.079 | 1.092 s | Yes |
| Wider base/deck braces, Heavy backstay | 3.938 | None | No |
| Wider base and upper braces, Heavy backstay | 3.680 | None | No |
| Final seven braces, Heavy backstay | 3.392 | None | No |
| Final seven braces, every rope Heavy | 3.820 | None | No |

Additional searches covered individual rope-profile combinations, reversed diagonals, shorter beam segments, raised/shortened pylons, extra backstays and fan cross-links. None tested met all criteria while retaining the chosen silhouette and supports. These unsuccessful candidates are not shipped as presets. No claim is made that all possible geometries have been exhausted.

The final right-start peak occurs inside the outer stay, rather than at a support: around 1.02 s a particle designed near (17.82, 6.47) reaches (16.90, 9.73), in editor coordinates with Y downward. A larger rope area alone cannot remove this sag because it also increases weight and does not supply initial tension.

**Proposed follow-up, not implemented:** add explicit per-rope pretension, beginning with a rest length 0.5% shorter than the designed distance and testing the range 0–1%. This represents a cable tensioned during installation, not a change to gravity or solver iterations. The resulting stored elastic energy and forces must act on the actual deck, pylon and foundations; the design must be remeasured for fractures, displacement and supports in all six variants. Old projects and Standard/Heavy defaults would retain zero pretension. This needs a separate model/editor/format decision and must not be disguised as a higher breaking threshold. Until validated, it is a proposal rather than a guaranteed fix.
