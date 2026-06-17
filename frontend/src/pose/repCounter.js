// Pushup rep state machine — ported from the Python backend (reps.py).
// up -> down -> up counts one rep, with hysteresis between the thresholds.

const DOWN_THRESHOLD = 90;
const UP_THRESHOLD = 150;

export class RepCounter {
  constructor() {
    this.count = 0;
    this.phase = "unknown"; // "unknown" | "up" | "down"
    this._seenDown = false;
    this._bottomElbow = 180;
    this._worstPlanarity = 0;
    this._worstSymmetry = 0;
  }

  // Returns a rep event object when a rep completes, else null.
  update(meanElbow, { planarity = null, symmetry = null } = {}) {
    if (meanElbow == null) return null;

    this._bottomElbow = Math.min(this._bottomElbow, meanElbow);
    if (planarity != null) this._worstPlanarity = Math.max(this._worstPlanarity, planarity);
    if (symmetry != null) this._worstSymmetry = Math.max(this._worstSymmetry, symmetry);

    if (meanElbow < DOWN_THRESHOLD) {
      if (this.phase !== "down") {
        this.phase = "down";
        this._seenDown = true;
      }
      return null;
    }
    if (meanElbow > UP_THRESHOLD) {
      const completed = this.phase === "down" && this._seenDown;
      this.phase = "up";
      if (completed) {
        const event = {
          rep_number: ++this.count,
          phase: "up",
          bottom_elbow_angle: Number(this._bottomElbow.toFixed(1)),
          worst_planarity_deviation: Number(this._worstPlanarity.toFixed(3)),
          worst_elbow_symmetry: Number(this._worstSymmetry.toFixed(1)),
        };
        this._reset();
        return event;
      }
      return null;
    }
    return null; // dead zone — hold phase
  }

  _reset() {
    this._seenDown = false;
    this._bottomElbow = 180;
    this._worstPlanarity = 0;
    this._worstSymmetry = 0;
  }
}
