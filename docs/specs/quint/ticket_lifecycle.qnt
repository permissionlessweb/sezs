// SEZS ticket lifecycle.
// P1: a ticket is admitted at most once.
// P3: cancel/refund never leaves a ticket both valid and refunded.
module ticket_lifecycle {
  type Id = str

  type Ticket = {
    reserved: bool,
    paid: bool,
    issued: bool,
    admitted: bool,
    cancelled: bool,
    refunded: bool,
  }

  var tickets: Id -> Ticket
  var admitCount: Id -> int

  val blank: Ticket = {
    reserved: false,
    paid: false,
    issued: false,
    admitted: false,
    cancelled: false,
    refunded: false,
  }

  def known(id: Id): bool = id.in(tickets.keys())

  def countOf(id: Id): int =
    if (id.in(admitCount.keys())) admitCount.get(id) else 0

  pure def valid(t: Ticket): bool = and {
    t.paid,
    t.issued or t.admitted,
    not(t.cancelled),
    not(t.refunded),
  }


  // P1. Admit count never exceeds one.
  val P1_admit_at_most_once: bool =
    tickets.keys().forall(id => countOf(id) <= 1)

  val P1_count_agrees: bool =
    tickets.keys().forall(id =>
      if (tickets.get(id).admitted) countOf(id) == 1 else countOf(id) == 0
    )

  // P3. Refunded or cancelled is never also valid.
  val P3_cancel_refund_exclusive: bool =
    tickets.keys().forall(id =>
      not(valid(tickets.get(id)) and (tickets.get(id).cancelled or tickets.get(id).refunded))
    )

  action init: bool = all {
    tickets' = Map(),
    admitCount' = Map(),
  }

  action reserve(id: Id): bool = all {
    not(known(id)),
    tickets' = tickets.put(id, { reserved: true, paid: false, issued: false, admitted: false, cancelled: false, refunded: false }),
    admitCount' = admitCount.put(id, 0),
  }

  action pay(id: Id): bool = all {
    known(id),
    tickets.get(id).reserved,
    not(tickets.get(id).paid),
    not(tickets.get(id).cancelled),
    not(tickets.get(id).refunded),
    tickets' = tickets.put(id, {
      reserved: true,
      paid: true,
      issued: false,
      admitted: false,
      cancelled: false,
      refunded: false,
    }),
    admitCount' = admitCount,
  }

  action issue(id: Id): bool = all {
    known(id),
    tickets.get(id).paid,
    not(tickets.get(id).issued),
    not(tickets.get(id).admitted),
    not(tickets.get(id).cancelled),
    not(tickets.get(id).refunded),
    tickets' = tickets.put(id, {
      reserved: tickets.get(id).reserved,
      paid: true,
      issued: true,
      admitted: false,
      cancelled: false,
      refunded: false,
    }),
    admitCount' = admitCount,
  }

  action admit(id: Id): bool = all {
    known(id),
    tickets.get(id).issued,
    not(tickets.get(id).admitted),
    not(tickets.get(id).cancelled),
    not(tickets.get(id).refunded),
    countOf(id) == 0,
    tickets' = tickets.put(id, {
      reserved: tickets.get(id).reserved,
      paid: true,
      issued: true,
      admitted: true,
      cancelled: false,
      refunded: false,
    }),
    admitCount' = admitCount.put(id, countOf(id) + 1),
  }

  action cancel(id: Id): bool = all {
    known(id),
    not(tickets.get(id).admitted),
    not(tickets.get(id).cancelled),
    not(tickets.get(id).refunded),
    tickets' = tickets.put(id, {
      reserved: tickets.get(id).reserved,
      paid: tickets.get(id).paid,
      issued: false,
      admitted: false,
      cancelled: true,
      refunded: tickets.get(id).refunded,
    }),
    admitCount' = admitCount,
  }

  action refund(id: Id): bool = all {
    known(id),
    tickets.get(id).paid,
    not(tickets.get(id).admitted),
    not(tickets.get(id).refunded),
    tickets' = tickets.put(id, {
      reserved: tickets.get(id).reserved,
      paid: tickets.get(id).paid,
      issued: false,
      admitted: false,
      cancelled: true,
      refunded: true,
    }),
    admitCount' = admitCount,
  }

  action step: bool =
    nondet id = oneOf(Set("t1", "t2", "t3"))
    any {
      reserve(id),
      pay(id),
      issue(id),
      admit(id),
      cancel(id),
      refund(id),
    }

  run happyPathAdmitsOnce = init
    .then(reserve("t1"))
    .then(pay("t1"))
    .then(issue("t1"))
    .then(admit("t1"))
    .expect(tickets.get("t1").admitted and countOf("t1") == 1 and P1_admit_at_most_once)

  run secondAdmitFails = init
    .then(reserve("t1"))
    .then(pay("t1"))
    .then(issue("t1"))
    .then(admit("t1"))
    .then(admit("t1"))
    .fail()

  run refundThenAdmitFails = init
    .then(reserve("t1"))
    .then(pay("t1"))
    .then(issue("t1"))
    .then(refund("t1"))
    .expect(not(valid(tickets.get("t1"))) and P3_cancel_refund_exclusive)
    .then(admit("t1"))
    .fail()

  run cancelClearsValid = init
    .then(reserve("t1"))
    .then(pay("t1"))
    .then(issue("t1"))
    .then(cancel("t1"))
    .expect(not(valid(tickets.get("t1"))) and tickets.get("t1").cancelled and P3_cancel_refund_exclusive)

  run admitThenRefundFails = init
    .then(reserve("t1"))
    .then(pay("t1"))
    .then(issue("t1"))
    .then(admit("t1"))
    .then(refund("t1"))
    .fail()
}
