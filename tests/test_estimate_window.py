import pytest

import main


@pytest.mark.parametrize("remaining,delay,visible", [
    (25, 0, True), (25.01, 0, True),
    (25.01, 10, True), (25.01, 11, False),
    (60, 0, True), (60, 10, True), (60.01, 10, False), (60, 11, False),
    (25, 60, True), (25.01, 60, False), (25, 61, False),
    (10, 61, False), (0, 119, False), (0, 120, False),
])
def test_estimate_window_boundaries(remaining, delay, visible):
    assert main._within_estimate_window(remaining, delay) is visible


@pytest.mark.parametrize("remaining,delay,corrected", [
    (30, 6, 3), (60, 6, 0), (60, 10, 4), (0, 10, 10),
    (10, 0, 0), (20, 11, 11), (20, 60, 60),
])
def test_corrected_delay(remaining, delay, corrected):
    assert main._corrected_delay_minutes(remaining, delay) == pytest.approx(corrected)
