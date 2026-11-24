// Door prepare / authorize / consume refinement of P1 and P2.
module door_consume {
  import ticket_lifecycle.* from "./ticket_lifecycle"
  import usher_authority.* from "./usher_authority"

  type DoorPhase = | Idle | Prepared | Authorized | Consumed | Rejected

  var phase: DoorPhase
  var preparedId: str
  var authorizedUsher: str

  val P1_door_consume_once: bool =
    or {
      phase != Consumed,
      and {
        preparedId.in(tickets.keys()),
        tickets.get(preparedId).admitted,
        countOf(preparedId) == 1,
      },
    }

  val P2_door_not_issued_by_usher: bool = P2_ushers_cannot_issue_or_forge

  action initDoor: bool = all {
    initAuth,
    phase' = Idle,
    preparedId' = "",
    authorizedUsher' = "",
  }

  action prepare(id: str): bool = all {
    id.in(tickets.keys()),
    tickets.get(id).issued,
    not(tickets.get(id).admitted),
    not(tickets.get(id).cancelled),
    not(tickets.get(id).refunded),
    phase == Idle or phase == Prepared,
    tickets' = tickets,
    admitCount' = admitCount,
    forged' = forged,
    phase' = Prepared,
    preparedId' = id,
    authorizedUsher' = "",
  }

  action authorize(usherName: str): bool = all {
    phase == Prepared,
    usherName == "usher1",
    tickets' = tickets,
    admitCount' = admitCount,
    forged' = forged,
    phase' = Authorized,
    preparedId' = preparedId,
    authorizedUsher' = usherName,
  }

  action consumeDoor: bool = all {
    phase == Authorized,
    authorizedUsher == "usher1",
    admit(preparedId),
    forged' = forged,
    phase' = Consumed,
    preparedId' = preparedId,
    authorizedUsher' = authorizedUsher,
  }

  action consumeAgain: bool = all {
    phase == Consumed,
    false,
    tickets' = tickets,
    admitCount' = admitCount,
    forged' = forged,
    phase' = phase,
    preparedId' = preparedId,
    authorizedUsher' = authorizedUsher,
  }


  action reserveDoor(id: str): bool = all {
    reserveAuth(id),
    phase' = phase,
    preparedId' = preparedId,
    authorizedUsher' = authorizedUsher,
  }

  action payDoor(id: str): bool = all {
    payAuth(id),
    phase' = phase,
    preparedId' = preparedId,
    authorizedUsher' = authorizedUsher,
  }

  action issueDoor(a: Actor, id: str): bool = all {
    issueBy(a, id),
    phase' = phase,
    preparedId' = preparedId,
    authorizedUsher' = authorizedUsher,
  }

  action stepDoor: bool =
    nondet id = oneOf(Set("t1"))
    any {
      reserveDoor(id),
      payDoor(id),
      issueDoor(alice, id),
      prepare(id),
      authorize("usher1"),
      consumeDoor,
      consumeAgain,
    }

  run doorHappyPath = initDoor
    .then(reserveDoor("t1"))
    .then(payDoor("t1"))
    .then(issueDoor(alice, "t1"))
    .then(prepare("t1"))
    .then(authorize("usher1"))
    .then(consumeDoor)
    .expect(phase == Consumed and tickets.get("t1").admitted and P1_door_consume_once and P2_door_not_issued_by_usher)

  run doorDoubleConsumeFails = initDoor
    .then(reserveDoor("t1"))
    .then(payDoor("t1"))
    .then(issueDoor(alice, "t1"))
    .then(prepare("t1"))
    .then(authorize("usher1"))
    .then(consumeDoor)
    .then(consumeAgain)
    .fail()
}
