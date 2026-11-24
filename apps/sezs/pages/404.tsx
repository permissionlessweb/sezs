import Link from 'next/link'

import { Frame } from '../src/ui/Frame'
import { Halo } from '../src/ui/primitives'

const Missing = () => (
  <Frame title="Not found · The event" shape="tetra" core={[0.5, 0.36]}>
    <Halo kicker="404" title="Not part of the night" sub="This page doesn't exist.">
      <Link className="pix-btn ghost" href="/">Back to the cellar</Link>
    </Halo>
  </Frame>
)

export default Missing
