import { Redirect } from '../src/ui/Redirect'

/** Notes / newsletter moved to blog docs. Old /notes links go home. */
const NotesGone = () => <Redirect to="/" label="Home" />

export default NotesGone
