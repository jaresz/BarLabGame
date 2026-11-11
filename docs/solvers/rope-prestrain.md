# Physical Rope Prestrain Prototype

Version 0.6.0 introduced a diagnostic initial engineering strain for each rope. Version 0.7.0 exposes uniform prestrain through an opt-in Settings control. It defaults to off on every page load; saved projects and gallery geometry remain unchanged. No project is automatically tensioned or upgraded.

## Physical model

A cable mounted at length `L` has the shorter stress-free length `L0 = L / (1 + epsilon0)`. Each of its existing axial segments uses the corresponding natural length `h0`. For the existing profile rigidity `EA`, its compliance is `h0 / EA`, mass contribution is based on `density * h0`, and tensile force is `max(0, EA * (l - h0) / h0)`. Shared positional particles sum the incident natural-length mass contributions normally.

The initial mounted force is `T0 = EA * epsilon0`, and stored energy is `U0 = 0.5 * EA * epsilon0^2 * L0`. These values describe the unperturbed mounting geometry. The existing signed startup imperfection is applied afterwards and can introduce a small additional strain. The report's initial forces and energy are analytical mounting values, not sums of measured support reactions.

| Initial engineering strain | Natural length of a 20-unit rope | Standard initial force | Heavy initial force |
| ---: | ---: | ---: | ---: |
| 0% | 20.000000 | 0 | 0 |
| 0.1% | 19.980020 | 80 | 320 |
| 0.25% | 19.950125 | 200 | 800 |
| 0.5% | 19.900498 | 400 | 1600 |
| 1% | 19.801980 | 800 | 3200 |

Forces, energies, masses and lengths use the game's model units. These are not calibrated engineering predictions for the real bridges. The specified percentage is strain relative to the natural length, not the percentage subtracted from the drawn length. Heavy retains four times Standard's area, density and axial rigidity. Its failure strain remains unchanged. Natural-length mass is slightly smaller for a tensioned rope because less unstretched material occupies the same mounted span; this does not change either profile's density.

Axial tension supplies transverse stiffness through the cable geometry, while the cable retains zero bending stiffness. This effect is demonstrated in [COMSOL's pretensioned-string example](https://doc.comsol.com/6.3/doc/com.comsol.help.models.sme.vibrating_string/vibrating_string.html). Tension can disappear if a cable slackens. No external actuator maintains a prescribed force throughout the motion.

Initial tension pulls on the real pylon, deck, foundations and any movable attachments from the first step. The run starts with stored elastic energy and zero velocity. There is no loading ramp, settling phase, hidden support or velocity reset. Gravity 9.81, DT = 1/120 s, twelve iterations, damping 0.65, material properties and damage rules are unchanged.

The existing ten-percent tensile-strain limit uses the shorter natural length too. Initial strain consumes part of that limit; it is not subtracted when checking damage. The ready frame reports initial relative stress without advancing the overload timer or emitting sounds. An overloaded member still fractures after six consecutive physics steps (0.05 s), with the existing midpoint split.

## Diagnostic API and compatibility

`PhysicsOptions.ropePrestrain?: readonly number[]` addresses ropes in the supplied normalized project's order. Each entry is a fraction, so `0.005` means 0.5%. Supplied arrays must contain exactly one finite numeric entry per rope, in the inclusive range 0–0.01. Sparse arrays, invalid values and incorrect lengths are rejected. The constructor owns a copy of the values.

```ts
const project = example('seriWawasan');
const world = new World(project, {
  ropePrestrain: project.ropes.map(() => 0.005),
  solver: 'serpentine',
  serpentineFromRight: false,
  initialPerturbation: 0.001,
});
```

This is an illustrative uniform setting, not a recommendation to tension every cable equally. Omitting the array means all zeros and preserves the previous trajectory exactly. The option does not enter `Rope`, project text, clipboard, prices or persisted settings. Format 4 and imports of formats 3 and 4 remain unchanged. A different rope ordering requires a correspondingly reordered diagnostic array.

## Editor option (0.7.0)

Settings contains **Rope prestrain (experimental)** between solver selection and canvas size. **Enable rope prestrain** starts unchecked. **Initial stretch** offers 0.1%, 0.25%, 0.5% and 1%, with 0.5% selected and the control disabled until enabled. Changes apply to the next Run immediately, independently of Apply size.

Each enabled start maps the current project's ropes to a fresh uniform `ropePrestrain` array. Both profiles receive the same strain; the existing Heavy rigidity produces four times the initial force. Turning the option off omits the array entirely. Beam-only projects pass an empty array when enabled, and empty projects still cannot start. There are no example-specific tension rules.

The setting survives editing, example loading, import, clear, resize, Undo/Redo and Run/Back within the same page. Disabling it preserves the selected amount, while reloading resets it to off and 0.5%. It is neither persisted nor part of project history or format 4. Settings stays disabled during simulation and pause. The active percentage remains in the Run tooltip and in simulation status, including pause and fracture messages. A compact drawing-area status label remains visible on small/touch layouts where the long footer message is hidden.

The physics model below and the recorded 0.6.0 measurements have not changed. The browser tests use real worker replies to verify initial stress for all four settings in both solvers, mixed profiles, omission when off, empty and beam-only projects, session lifetime, unchanged exports/costs/history and responsive Settings on desktop and portrait/landscape touch screens.

## Experiment and acceptance

The experiment holds all geometry, profiles and supports fixed. It includes the current Seri Wawasan, Golden Gate, and all three saved 48 × 32 Seri Wawasan candidates. Each model has two independently varied groups: front stays / rear guys, or main cable / hangers. All segments of a logical stay receive the same group's strain. Front and rear grouping uses fixture geometry, including the all-Heavy candidate; it is not inferred from profile names and is not part of the solver.

Each group uses 0%, 0.1%, 0.25%, 0.5% or 1%. All 25 combinations receive three complete four-second screens, with Basic XPBD, left-start Serpentine and right-start Serpentine, each with +0.001 imperfection. Screening continues after a failure. Settings are ranked lexicographically by total broken members, total new boundary-contact samples, worst displacement, total group strain, then the first and second strain as deterministic tie-breakers. Failed screens remain in the raw reports.

The zero setting and the two highest-ranked nonzero settings per model receive six complete twenty-second trials: all three schedules with both +0.001 and -0.001 imperfection. This is 375 screening trajectories and 90 full trajectories across the five models. A setting's rank is based only on the defined screens; the full trials can expose later failures.

Every particle is checked at initialization and after every step, including cable and beam interiors. Acceptance requires finite positions and velocities, no fracture, maximum displacement at most 2.5 units from the unperturbed design, exactly stationary supports and no new contacts with any board edge. Initial foundation/abutment contacts are permitted. Contacts count particle/step samples, not distinct impacts. Short screens are not twenty-second stability evidence.

## Measured results (0.6.0)

All 375 four-second screens and all 90 twenty-second trials completed. All states remained finite and every support remained exactly stationary. The zero-prestrain full trials match the previously saved 0.5.0 measurements exactly for every metric, including the three failed larger designs. No project geometry or material profile changed.

Strain pairs below mean **front stays / rear guys**, except for Golden Gate, where they mean **main cable / hangers**. Peak is the worst displacement across six full trajectories. Energy is the analytical initial total for the mounted ropes, in model units. Broken counts are the minimum–maximum number of broken members at twenty seconds.

| Model | Strain pair | Peak displacement | Passing trials | Broken members | New contacts | Initial energy |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| Seri Wawasan (small) | 0% / 0% | 2.138 | 6/6 | 0 | No | 0.000 |
| Seri Wawasan (small) | 1% / 1% | 1.847 | 6/6 | 0 | No | 345.255 |
| Seri Wawasan (small) | 1% / 0.5% | 1.881 | 6/6 | 0 | No | 226.641 |
| Golden Gate | 0% / 0% | 1.005 | 6/6 | 0 | No | 0.000 |
| Golden Gate | 1% / 1% | 0.763 | 6/6 | 0 | No | 737.063 |
| Golden Gate | 1% / 0.1% | 0.772 | 6/6 | 0 | No | 568.484 |
| Fork, Standard front | 0% / 0% | 24.949 | 0/6 | 6–7 | Yes | 0.000 |
| Fork, Standard front | 0.1% / 0.1% | 24.435 | 0/6 | 6–14 | Yes | 25.707 |
| Fork, Standard front | 0% / 0.1% | 24.432 | 0/6 | 6–14 | Yes | 20.594 |
| Fork, Heavy front | 0% / 0% | 25.073 | 0/6 | 5–20 | Yes | 0.000 |
| Fork, Heavy front | 0% / 1% | 25.019 | 0/6 | 5–13 | Yes | 2041.080 |
| Fork, Heavy front | 0% / 0.5% | 25.045 | 0/6 | 5–21 | Yes | 512.809 |
| Wider lattice | 0% / 0% | 24.170 | 0/6 | 0–29 | Yes | 0.000 |
| Wider lattice | 1% / 1% | 4.685 | 0/6 | 0 | No | 2118.292 |
| Wider lattice | 0.5% / 1% | 4.812 | 0/6 | 0 | No | 1637.104 |

For the existing small bridges, 1% in both groups reduces the worst Seri Wawasan displacement from 2.138 to 1.847 (13.6%) and Golden Gate from 1.005 to 0.763 (24.0%). Both selected nonzero settings for each bridge pass all six trials. All 25 settings per small bridge also pass all three short screens; the full twenty-second confirmation applies only to the three settings shown per model.

The wider lattice is the strongest large-design result: both selected settings survive all six complete trials with no fractures or new contacts, versus two fracture trajectories in the zero setting. Nevertheless, its 4.685-unit best peak still exceeds 2.5, so it fails the full criterion. The 24.170-unit baseline includes post-fracture collapse and must not be interpreted as an elastic-stiffness comparison with the intact tensioned design.

Both forked designs still fail all full trials, including the selected settings. First fractures among those nonzero settings occur at approximately 0.83–1.83 seconds. The Standard-front fork's left-start fracture count reaches 14 at twenty seconds, versus 7 without prestrain: the short-screen ranking does not guarantee a better long-run outcome. All 25 settings of each larger design fail at least one short-screen criterion, even when no members break.

Higher preload can worsen damage. In the Heavy-front fork, 1% front strain with zero rear strain produces 44 broken members summed over the three four-second screens, versus 33 without preload. These are separate screening trajectories, not the six full trials. Every failed combination and its initial force/energy is retained in the raw reports.

### Assessment

Physical prestrain produces the intended transverse-stiffening effect and can substantially improve an intact structure. It is useful as a design parameter, but cannot replace sufficient pylon, deck and foundation stiffness. The simple suspended-cable regression also shows monotonically lower peak sag at 0%, 0.5% and 1%, with no bending constraints added.

The present experiment supports further geometry work on the wider lattice. It does not justify integrating a larger Seri Wawasan or applying 1% automatically: the best small-bridge settings lie at the upper edge of the tested grid, and no globally optimal or real-material-safe value has been established. The opt-in uniform session control introduced in 0.7.0 reuses this model; per-rope editing and persistence remain outside its scope. Gallery projects retain zero prestrain in their saved data. Normal play uses zero unless the session option introduced in 0.7.0 is explicitly enabled.

Raw reports, including all failed screens and both shortlisted nonzero settings:

- [Seri Wawasan (small)](rope-prestrain/seriWawasan.json).
- [Golden Gate](rope-prestrain/goldenGate.json).
- [Fork, Standard front](rope-prestrain/fork-standard-front.json).
- [Fork, Heavy front](rope-prestrain/fork-heavy-front.json).
- [Wider lattice](rope-prestrain/wide-lattice.json).

## Reproduction and tests

```powershell
node --import tsx scripts/measure-prestrain.ts
# Independent models can also be measured separately:
node --import tsx scripts/measure-prestrain.ts --model wide-lattice
npm test
$env:FRAME_LAB_CHROMIUM = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:browser
```

Each completed model writes its own report under `docs/solvers/rope-prestrain/`. Reports include the exact format-4 geometry, all screening combinations, ranking rules, full trials, and per-rope mounting force, natural length, mass and stored energy. They do not modify the gallery or the older measurement reports.

The test suite verifies validation, natural lengths, compliance, mass, initial force and energy for both profiles, incident mass summation, slackness, first-step attachment movement, transverse stiffening under gravity, free-cable momentum, reduced failure reserve, segmented-stay grouping and screening ranking. Explicit zero arrays match omitted options exactly in all three schedules and both imperfection signs. Existing model, physics, landmark, sound and browser tests remain required.

Release validation: `npm test`, all ten prestrain regressions, and the complete `npm run test:browser` passed. The browser suite includes the production build, desktop/mobile interactions, real workers, update handling and offline use.
