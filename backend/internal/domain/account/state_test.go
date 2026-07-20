package account

import "testing"

func TestApplyStateEventDoesNotReauthOnTransientFailure(t *testing.T) {
	cases := []State{StateReady, StateDegraded, StateCooldown}
	for _, current := range cases {
		if got := ApplyStateEvent(current, true, StateEventInput{Event: EventTransientFailure}); got != StateDegraded {
			t.Fatalf("current=%s: got %s, want degraded", current, got)
		}
	}
}

func TestApplyStateEventRequiresExplicitCredentialEvidence(t *testing.T) {
	if got := ApplyStateEvent(StateReady, true, StateEventInput{Event: EventCredentialRejected}); got != StateReauthRequired {
		t.Fatalf("got %s, want reauth_required", got)
	}
	if got := ApplyStateEvent(StateReady, true, StateEventInput{Event: EventTransientFailure}); got == StateReauthRequired {
		t.Fatal("transient failure must not reauthenticate an account")
	}
}

func TestApplyStateEventDisabledWins(t *testing.T) {
	if got := ApplyStateEvent(StateReady, false, StateEventInput{Event: EventRequestSucceeded}); got != StateDisabled {
		t.Fatalf("got %s, want disabled", got)
	}
}

func TestApplyStateEventCooldownDoesNotReauth(t *testing.T) {
	if got := ApplyStateEvent(StateReady, true, StateEventInput{Event: EventCooldownStarted}); got != StateCooldown {
		t.Fatalf("got %s, want cooldown", got)
	}
}
