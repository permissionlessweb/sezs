// SEZS usher authority.
// Session coordinators may issue; ushers may admit only.
// P2: ushers cannot issue or forge tickets.
module usher_authority {
  import ticket_lifecycle.* from "./ticket_lifecycle"

  type Role = | SessionCoordinator | Usher | Holder | Outsider

  type Actor = {
    name: str,
    role: Role,
  }

  val alice: Actor = { name: "alice", role: SessionCoordinator }
  val usher1: Actor = { name: "usher1", role: Usher }
  val mallory: Actor = { name: "mallory", role: Outsider }

  var forged: Set[str]

  pure def isUsher(a: Actor): bool = a.role == Usher
  pure def canIssue(a: Actor): bool = a.role == SessionCoordinator
  pure def canConsume(a: Actor): bool = a.role == Usher

  val P2_ushers_cannot_issue_or_forge: bool = size(forged) == 0

  action initAuth: bool = all {
    init,
    forged' = Set(),
  }

  action reserveAuth(id: str): bool = all {
    reserve(id),
    forged' = forged,
  }

  action payAuth(id: str): bool = all {
    pay(id),
    forged' = forged,
  }

  action cancelAuth(id: str): bool = all {
    cancel(id),
    forged' = forged,
  }

  action refundAuth(id: str): bool = all {
    refund(id),
    forged' = forged,
  }

  action issueBy(a: Actor, id: str): bool = all {
    canIssue(a),
    issue(id),
    forged' = forged,
  }

  action consumeBy(a: Actor, id: str): bool = all {
    canConsume(a),
    admit(id),
    forged' = forged,
  }

  // Dishonest: an usher tries to issue. This MUST NOT succeed.
  action usherIssue(a: Actor, id: str): bool = all {
    isUsher(a),
    false,
    tickets' = tickets,
    admitCount' = admitCount,
    forged' = forged,
  }

  // Dishonest: anyone tries to insert a forged commitment.
  action forge(a: Actor, id: str): bool = all {
    false,
    tickets' = tickets,
    admitCount' = admitCount,
    forged' = forged,
  }

  action stepAuth: bool =
    nondet id = oneOf(Set("t1", "t2"))
    any {
      reserveAuth(id),
      payAuth(id),
      issueBy(alice, id),
      consumeBy(usher1, id),
      cancelAuth(id),
      refundAuth(id),
      usherIssue(usher1, id),
      forge(mallory, id),
      forge(usher1, id),
    }

  run usherCannotIssue = initAuth
    .then(reserveAuth("t1"))
    .then(payAuth("t1"))
    .then(usherIssue(usher1, "t1"))
    .fail()

  run usherCannotForge = initAuth
    .then(forge(usher1, "t-fake"))
    .fail()

  run outsiderCannotForge = initAuth
    .then(forge(mallory, "t-fake"))
    .fail()

  run sessionCoordinatorIssuesUsherAdmits = initAuth
    .then(reserveAuth("t1"))
    .then(payAuth("t1"))
    .then(issueBy(alice, "t1"))
    .then(consumeBy(usher1, "t1"))
    .expect(tickets.get("t1").admitted and P2_ushers_cannot_issue_or_forge and P1_admit_at_most_once)
}
