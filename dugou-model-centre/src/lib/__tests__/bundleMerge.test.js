/**
 * Regression tests for the git-sync snapshot merge (api/_shared.js).
 *
 * Guards the bug where cycle settlements / capital injections — append-only
 * ledgers stored inside system_config — were wiped on every reload because
 * an empty/stale remote config overwrote them wholesale.
 */

import { describe, it, expect } from 'vitest'
import { mergeBundles } from '../../../api/_shared.js'

describe('mergeBundles — system_config ledgers', () => {
  it('preserves stored ledgers when the incoming config is empty (the reload-wipe regression)', () => {
    const stored = {
      system_config: {
        initialCapital: 600,
        poolSettlements: [{ id: 's1', type: 'profit', realizedProfit: 120 }],
        capitalInjections: [{ id: 'i1', amount: 100 }],
      },
      investments: [],
    }
    // A fresh device / empty git seed: config present but ledgers empty.
    const incoming = {
      system_config: { initialCapital: 600, poolSettlements: [], capitalInjections: [] },
      investments: [],
    }

    const merged = mergeBundles(stored, incoming)

    expect(merged.system_config.poolSettlements).toHaveLength(1)
    expect(merged.system_config.poolSettlements[0].id).toBe('s1')
    expect(merged.system_config.capitalInjections).toHaveLength(1)
    expect(merged.system_config.capitalInjections[0].id).toBe('i1')
  })

  it('unions ledgers by id across both sides', () => {
    const stored = { system_config: { poolSettlements: [{ id: 's1' }] } }
    const incoming = { system_config: { poolSettlements: [{ id: 's2' }] } }

    const merged = mergeBundles(stored, incoming)
    const ids = merged.system_config.poolSettlements.map((x) => x.id).sort()

    expect(ids).toEqual(['s1', 's2'])
  })

  it('lets incoming scalar config win while keeping ledgers safe', () => {
    const stored = { system_config: { initialCapital: 600, poolSettlements: [{ id: 's1' }] } }
    const incoming = { system_config: { initialCapital: 800, poolSettlements: [] } }

    const merged = mergeBundles(stored, incoming)

    expect(merged.system_config.initialCapital).toBe(800)
    expect(merged.system_config.poolSettlements).toHaveLength(1)
  })

  it('still unions investments by id — incoming wins per id, stored survives', () => {
    const stored = { investments: [{ id: 'a', v: 1 }, { id: 'b', v: 1 }] }
    const incoming = { investments: [{ id: 'a', v: 2 }] }

    const merged = mergeBundles(stored, incoming)
    const byId = Object.fromEntries(merged.investments.map((x) => [x.id, x.v]))

    expect(byId).toEqual({ a: 2, b: 1 })
  })
})
