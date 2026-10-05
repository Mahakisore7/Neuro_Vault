"""SM-2 spaced-repetition scheduling, as a pure function.

No database, no clock: given a card's current schedule and how well it was
recalled, return the next schedule. Keeping it pure is what makes every
branch of the algorithm unit-testable in isolation.

Quality is SM-2's 0-5 scale: 5 perfect, 4 correct after hesitation, 3
correct with difficulty, 2 / 1 / 0 increasingly wrong. Anything below 3 is a
lapse.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

MIN_EASE = Decimal("1.30")
# SM-2 itself lets ease climb above its 2.50 starting value; this schema caps
# it there (ck_flashcards_ease_factor_range), so the scheduler must too, or a
# run of perfect answers would violate the CHECK.
MAX_EASE = Decimal("2.50")
# Without a ceiling an interval multiplied by ~2.5 per review overflows
# Python's datetime (year 9999) after a couple of dozen perfect reviews.
MAX_INTERVAL_DAYS = 36500

_CENT = Decimal("0.01")


@dataclass(frozen=True)
class Schedule:
    ease_factor: Decimal
    interval_days: int
    repetitions: int


def next_schedule(current: Schedule, quality: int) -> Schedule:
    if not 0 <= quality <= 5:
        raise ValueError(f"quality must be 0-5, got {quality}")

    # Decimal throughout, matching the NUMERIC(4,2) column: in float,
    # 2.5 - 0.14 accumulates representation error across reviews.
    q = Decimal(quality)
    ease = current.ease_factor + (
        Decimal("0.1") - (5 - q) * (Decimal("0.08") + (5 - q) * Decimal("0.02"))
    )
    ease = min(MAX_EASE, max(MIN_EASE, ease.quantize(_CENT, rounding=ROUND_HALF_UP)))

    if quality < 3:
        # A lapse restarts the learning sequence; the ease penalty above is
        # kept, so a card that keeps being forgotten comes back more often.
        return Schedule(ease_factor=ease, interval_days=1, repetitions=0)

    if current.repetitions == 0:
        interval = 1
    elif current.repetitions == 1:
        interval = 6
    else:
        # The previous interval grows by the *new* ease factor, rounded to
        # whole days - interval_days is an INTEGER column.
        interval = int(
            (Decimal(current.interval_days) * ease).quantize(Decimal(1), rounding=ROUND_HALF_UP)
        )

    return Schedule(
        ease_factor=ease,
        interval_days=min(interval, MAX_INTERVAL_DAYS),
        repetitions=current.repetitions + 1,
    )
