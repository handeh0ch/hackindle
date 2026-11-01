# KOReader compatibility preflight

Status: P0 open. These are limited observations from synthetic fixtures on KOReader v2026.07.1, not a completed compatibility certification or a production sync release.

| Area | Observed evidence | Still unverified |
| --- | --- | --- |
| Diagnostic loading | Owner manually installed and invoked the opt-in action; observations were appended | Crash/resume behavior of the production plugin |
| CRE text | Successful native extraction in three observations; position unchanged; screen pagination changed with layout | Stable union/Unicode/boundary rules and selection restoration |
| PDF primitives | Original-page text boxes and page/screen transforms returned data; sampled positions mapped to the expected physical page | Same-page zoom comparison, visible-text intersection, reflow/rotation/partial words |
| Native timing | Restricted read-only lookup found positive persisted native intervals for both synthetic sources | Native-to-service identity and crash handoff, lifecycle-window allocation |

The initial current-page-only logger captured zero placeholders even though completed rows existed in native storage. Its zeros must not be interpreted as no reading time. Native credit is capped and native pause handling can shift timestamps; exact continuous wall-clock coverage is not established by a native tuple. The data contract explicitly distinguishes native credit from its reporting-day allocation.

The follow-up diagnostic adds actual-engine controlled CRE range checks and raw visible-page observations. Host-side Python verification validates artifacts/fingerprints, not Lua execution or renderer behavior. The owner must run those checks on the device before treating their assertions as evidence.

Raw observations and exact timestamps stay in ignored local storage; this file contains only synthetic aggregate findings. All device copying is done by the owner. No new tools were downloaded for this preflight and no device files were written by the agent.
