# sezs-minirelay-loopback

Optional loopback wrapper around Zafu minirelay. It is not part of
`just test`, `just build`, or `just check-crates`. Wire a published git
dependency or a local `SEZS_ZAFU_ROOT` checkout before building this
package; a clean clone does not assume a sibling zafu tree.
