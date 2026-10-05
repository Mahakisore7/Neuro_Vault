"""SM-2 scheduler, tested as a pure function - no database involved."""

import random
from decimal import Decimal

import pytest

from app.services.sm2 import MAX_INTERVAL_DAYS, Schedule, next_schedule

NEW = Schedule(ease_factor=Decimal("2.50"), interval_days=1, repetitions=0)


def test_first_two_successes_use_the_fixed_1_then_6_day_intervals():
    first = next_schedule(NEW, 4)
    second = next_schedule(first, 4)

    assert (first.interval_days, first.repetitions) == (1, 1)
    assert (second.interval_days, second.repetitions) == (6, 2)


def test_later_successes_multiply_the_interval_by_the_ease_factor():
    card = Schedule(ease_factor=Decimal("2.50"), interval_days=6, repetitions=2)

    assert next_schedule(card, 4).interval_days == 15  # 6 * 2.50


@pytest.mark.parametrize(
    ("quality", "expected_ease"),
    [
        (5, "2.50"),  # +0.10, but capped at the schema's 2.50 ceiling
        (4, "2.50"),  # +0.00
        (3, "2.36"),  # -0.14
        (2, "2.18"),  # -0.32
        (1, "1.96"),  # -0.54
        (0, "1.70"),  # -0.80
    ],
)
def test_ease_adjustment_matches_the_sm2_formula(quality, expected_ease):
    assert next_schedule(NEW, quality).ease_factor == Decimal(expected_ease)


def test_a_lapse_restarts_the_sequence_but_keeps_the_ease_penalty():
    learned = Schedule(ease_factor=Decimal("2.30"), interval_days=40, repetitions=5)

    lapsed = next_schedule(learned, 1)

    assert (lapsed.interval_days, lapsed.repetitions) == (1, 0)
    assert lapsed.ease_factor == Decimal("1.76")


def test_ease_never_drops_below_the_1_30_floor():
    card = NEW
    for _ in range(10):
        card = next_schedule(card, 0)

    assert card.ease_factor == Decimal("1.30")


def test_interval_is_capped_instead_of_overflowing_datetime():
    card = NEW
    for _ in range(60):
        card = next_schedule(card, 5)

    assert card.interval_days == MAX_INTERVAL_DAYS


@pytest.mark.parametrize("quality", [-1, 6])
def test_quality_outside_0_to_5_is_rejected(quality):
    with pytest.raises(ValueError):
        next_schedule(NEW, quality)


def test_no_review_sequence_can_violate_the_table_check_constraints():
    """The CHECKs on flashcards encode SM-2's invariants; this is the
    scheduler's side of that contract, over 2,000 random review histories.
    Exact two-decimal Decimals throughout, so NUMERIC(4,2) stores them as-is.
    """
    rng = random.Random(2026)  # noqa: S311 - seeded test data, not security
    for _ in range(2000):
        card = NEW
        for _ in range(rng.randint(1, 40)):
            card = next_schedule(card, rng.randint(0, 5))
            assert Decimal("1.30") <= card.ease_factor <= Decimal("2.50")
            assert card.ease_factor == card.ease_factor.quantize(Decimal("0.01"))
            assert 1 <= card.interval_days <= MAX_INTERVAL_DAYS
            assert card.repetitions >= 0
