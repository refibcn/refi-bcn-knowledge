// Derivations for the home page's reconciliation prose.
//
// These live here rather than in index.astro's frontmatter for one reason:
// they encode invariants about how the matrix, the sources view-model and the
// store relate to each other, and component frontmatter cannot be imported by
// `node --test` — so an invariant asserted there is an invariant nothing can
// check. Everything below is a pure function of already-computed view-models:
// this module reads no store, no YAML and no disk, and must not start.
//
// Dual-path is inherited, not re-implemented: every number handed in comes
// from matrixViewModel() or sourcesViewModel(), which resolve the workspace
// store vs the committed aggregate behind one shape before we see it.

/** Every loop note declared on a matrix column, in column order.
 *
 *  Plural on purpose. `matrix.yaml` permits `loop:` on any column and nothing
 *  makes it exclusive, so taking `.find()` would silently drop the second one
 *  the day someone adds it — the same "a new fact must be visible before it is
 *  described" rule matrix.mjs applies to un-listed source cards (DC-1). With
 *  one loop declared this returns a single-element list and the page renders
 *  exactly what it rendered before.
 *
 *  @param {readonly {loop?: string | null}[]} columns
 *  @returns {string[]} */
export function loopNotes(columns) {
  return columns
    .map((c) => c.loop)
    .filter((l) => typeof l === "string" && l.length > 0);
}

/**
 * Reconcile the three container counts the home page puts in front of a reader.
 *
 * They have three different denominators and a reader who counts the matrix's
 * columns against the status strip gets two different answers:
 *
 *   - the matrix   = carded columns + planned columns
 *   - the footnote = infrastructure containers (role !== "source")
 *   - the strip    = every container with a card, of any role
 *
 * so the strip should be `carded + infrastructure`. That identity is NOT
 * structural. `assembleMatrix()` reaches a column by id regardless of the
 * row's role (matrix.mjs), while `footnote` filters on `role !== "source"` —
 * so a `matrix.yaml` column naming an infrastructure container (say
 * `refibcn-site`) renders that container as BOTH a matrix column and a
 * footnote entry, double-counting it and making the arithmetic false while
 * every individual number stays correct.
 *
 * Hence `reconciles`: computed, never assumed. The page states the arithmetic
 * only when it holds and declares a fault when it does not — the same way it
 * treats `unattributed`, surfaced only on failure.
 *
 * @param {{columns: readonly {planned: boolean}[], footnote: readonly unknown[], containers: number}} args
 * @returns {{carded: number, planned: number, infrastructure: number, containers: number, reconciles: boolean}}
 */
export function containerCounts({ columns, footnote, containers }) {
  const carded = columns.filter((c) => !c.planned).length;
  const planned = columns.filter((c) => c.planned).length;
  const infrastructure = footnote.length;
  return {
    carded,
    planned,
    infrastructure,
    containers,
    reconciles: containers === carded + infrastructure,
  };
}
