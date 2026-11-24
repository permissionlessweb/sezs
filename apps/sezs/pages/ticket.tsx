import { Frame } from '../src/ui/Frame'
import { Halo, Movement } from '../src/ui/primitives'
import { TicketWallet } from '../src/event/TicketWallet'
import { useEvent } from '../src/event/useEvent'
import { eventNameOf } from '../src/event/title'

const TicketPage = () => {
  const ev = useEvent()
  const name = eventNameOf(ev.data?.event.name)
  return (
    <Frame title={`Tickets · ${name}`} shape="ring" core={[0.55, 0.22]} intensity={0.7}>
      <Halo compact title="Tickets" />
      <Movement title="Tickets" align="center">
        <TicketWallet eventName={name} eventId={ev.data?.event.id} />
      </Movement>
    </Frame>
  )
}

export default TicketPage
