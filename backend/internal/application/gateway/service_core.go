package gateway

type routingAttemptPolicy struct {
	limit     int
	unlimited bool
}

func newRoutingAttemptPolicy(configured int) routingAttemptPolicy {
	if configured == unlimitedRoutingAttempts {
		return routingAttemptPolicy{unlimited: true}
	}
	if configured <= 0 {
		configured = 3
	}
	return routingAttemptPolicy{limit: configured}
}

func newRequestRoutingAttemptPolicy(configured int, pinned bool) routingAttemptPolicy {
	if pinned {
		return newRoutingAttemptPolicy(1)
	}
	return newRoutingAttemptPolicy(configured)
}

func (p routingAttemptPolicy) allows(attempt int) bool {
	return p.unlimited || attempt < p.limit
}

func (p routingAttemptPolicy) hasNext(attempt int) bool {
	return p.unlimited || attempt+1 < p.limit
}
