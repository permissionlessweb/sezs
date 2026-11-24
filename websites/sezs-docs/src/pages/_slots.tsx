export function SidebarHeader() {
  return (
    <a href="/alpha/sezs/docs/" className="sez-brand">
      <img className="sez-brand-mark sez-brand-mark--dark" src="/alpha/sezs/docs/sez-mark.svg" alt="" />
      <img className="sez-brand-mark sez-brand-mark--light" src="/alpha/sezs/docs/sez-mark-light.svg" alt="" />
      <span className="sez-brand-word">
        <span>SPEAKEZ</span>
        <span className="sez-brand-dot">·</span>
        <span>SESSIONS</span>
      </span>
    </a>
  )
}

export function Footer() {
  return (
    <div className="sezs-docs-footer">
      <a href="/alpha/sezs/docs/disclaimers">Disclaimers</a>
      <a href="https://permissionless.money/alpha/sezs/">permissionless.money/alpha/sezs/</a>
      <span className="sezs-docs-footer-note">SPEAKEZ · SESSIONS · one room, one light</span>
    </div>
  )
}
