# Solver Algorithms

This guide describes the three solvers in Bar Lab **0.4.59**. [Basic XPBD Solver](original.md) preserves the original behavior. [Serpentine](serpentine.md) is selected when the app opens and changes the order of local corrections. [Backward](backward.md) also estimates loads carried toward supports. Select a solver in Settings; the choice lasts until the page reloads.

| Solver | Order of corrections | Relative stress indicator | Detailed guide |
| --- | --- | --- | --- |
| 1 · Basic XPBD Solver (original) | Constraint creation order, alternating forward and reverse passes | Axial strain and curvature | [Basic XPBD Solver](original.md) |
| 2 · Serpentine (serpentine) | Top-down serpentine scan, with a randomly chosen starting side | Same strain measures as Basic XPBD Solver | [Serpentine solver](serpentine.md) |
| 3 · Backward (backward) | Support-distance layers and branch loads, followed by a reverse pass | Maximum of deformation and estimated load indicators | [Backward solver](backward.md) |

All three use the same particle model, fixed time step, material profiles, and local XPBD corrections. Backward extends that model with a load estimate and a different correction order; it does not solve a global finite element stiffness matrix.

## Shared example and labels

![Tower with nodes A–E and beams b1–b4](../images/solvers/tower.png)

**A** is the only support, fixed at the bottom edge of the board. **B** joins lower column **b4** to upper column **b2**. **C** joins **b1**, **b2**, and **b3**. **D** and **E** are free ends of diagonal beams; neither rests on the ground. All joints are rigid, and all beams use the Light profile.

| Beam | Endpoints | Length | Number of segments n | Number of particles n + 2 |
| --- | --- | ---: | ---: | ---: |
| b1 | D–C | √34 ≈ 5.830952 | 12 | 14 |
| b2 | C–B | 5 | 10 | 12 |
| b3 | C–E | √34 ≈ 5.830952 | 12 | 14 |
| b4 | B–A | 6 | 12 | 14 |

The model has 54 particles in total. Export coordinates start at the center of the board and increase upward along Y. Physics coordinates start at the top-left corner and increase downward along Y. On a 12 × 12 board:

~~~text
x_internal = x_export + 6
y_internal = 6 − y_export
C: (0, 5) → (6, 1)
A: (0, −6) → (6, 12)
~~~

In the animations, gray **b1–b4**, **A**, **B**, **C₀**, **D**, and **E** mark the initial shape. Orange **C(t)** tracks the moving top joint. That joint contains several particles connected by constraints, so ΔxC is their mean X position minus their initial X position of 6.

Load the example from [tower.json](tower.json). The measured trajectories and parameters are in [measurements.json](measurements.json).

## Parameters and units

The physics step is Δt = 1/120 s, gravity is g = 9.81, damping is d = 0.65 s⁻¹, and each step uses 12 constraint iterations. Display frame rate does not set the physics step. The worker converts elapsed time into fixed steps, processing at most eight per message.

One length unit is one board cell. Mass and force use arbitrary game units. Axial and bending stiffness are effective parameters of this model. “Relative stress” is a dimensionless indicator, not stress in pascals.

| Profile | Beam linear density ρ | Effective axial stiffness KA | Effective bending stiffness KB | Curvature-limit multiplier |
| --- | ---: | ---: | ---: | ---: |
| Light | 0.9 | 1,000,000 | 2,500 | 1.4 |
| Standard | 1.8 | 2,000,000 | 10,000 | 1 |
| Heavy | 3.6 | 4,000,000 | 40,000 | 0.7 |

Ropes have a linear density of 0.22 and axial stiffness of 80,000. They have no bending constraints. They can carry tension but the unilateral local constraint does not let them carry compression.

## Comparison of simulated results

These values come from World.step() with the same project and settings. For a reproducible comparison, the two Serpentine runs explicitly specify the starting side. The app chooses one side pseudorandomly for each new run.

| Solver | ΔxC after 5 s | ΔxC after 10 s | Breaks by 12 s |
| --- | ---: | ---: | ---: |
| Basic XPBD Solver | −0.519741 | −5.995179 | 0 |
| Serpentine, left start | −0.332517 | −5.993631 | 0 |
| Serpentine, right start | +0.400614 | +5.989180 | 0 |
| Backward | −0.396398 | −5.993729 | 0 |

The example demonstrates sensitivity to correction order; it does not rank solver accuracy. The sign of a small early displacement can change before the final lean. No beam breaks in these runs: the structure bends and eventually reaches a board boundary. Randomizing the Serpentine starting side does not guarantee mirror symmetry or stability.

## Animations and reproduction

- [Basic XPBD Solver animation and explanation](original.md#animation).
- [Serpentine animation showing both starts](serpentine.md#animation).
- [Backward animation and explanation](backward.md#animation).

The animations cover 12 seconds of simulated time at 1× speed, sampled at up to 10 frames per second. Their first and last frames are held longer for readability. The images render sampled simulation data; beam positions are neither hand-authored nor interpolated.

~~~powershell
node --import tsx scripts/generate-solver-docs.ts
python scripts/render-solver-docs.py
~~~

Run both commands from the project root. Rendering requires Python 3, Pillow, and either Arial on Windows or DejaVu Sans on Linux. The first script checks the numerical distance-correction and Backward force/moment examples and records measurements. The second renders the labeled PNG and GIF files in docs/images/solvers/. Raw sampled frames are stored in the ignored screenshots/solver-docs/ directory.

Implementation: [model and profiles](../../src/model.ts), [World and XPBD](../../src/physics.ts), [ordering and propagation strategies](../../src/solver-strategies.ts), [run-time selection](../../src/main.ts), [worker](../../src/simulation.worker.ts).

[User guide](../user-guide.md) · [Development guide](../development.md)
