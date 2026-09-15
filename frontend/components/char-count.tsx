/**
 * Inline character counter shown below a text input or textarea.
 * Turns amber at 90 % of max, red at 100 %.
 */
export function CharCount({
  current,
  max,
  hint,
}: {
  current: number;
  max: number;
  hint?: string;
}) {
  const pct = current / max;
  const cls =
    current >= max
      ? "char-count char-count--over"
      : pct >= 0.9
      ? "char-count char-count--warn"
      : "char-count";

  return (
    <div className="field-footer">
      {hint ? <span style={{ fontSize: ".74rem", color: "#94a3b8" }}>{hint}</span> : <span />}
      <span className={cls} aria-live="polite" aria-label={`${current} of ${max} characters used`}>
        {current}/{max}
      </span>
    </div>
  );
}
