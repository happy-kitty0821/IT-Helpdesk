import os
from hypothesis import settings, HealthCheck

# Register Hypothesis profiles for the dynamic-service-forms property tests.
settings.register_profile(
    "default",
    max_examples=100,
    suppress_health_check=[HealthCheck.too_slow],
)
settings.register_profile(
    "ci",
    max_examples=200,
    suppress_health_check=[HealthCheck.too_slow],
)

# Load profile from environment; fall back to 'default'.
settings.load_profile(os.environ.get("HYPOTHESIS_PROFILE", "default"))
