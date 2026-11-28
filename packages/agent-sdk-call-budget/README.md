# Agent SDK call budget

This test measures calls from a streamed run facet to its root Durable Object. It streams 5,000 text chunks and counts root `_cf_broadcastToSubAgent` calls, with zero viewers and with one viewer. The viewer case also checks that it receives every chunk in order.

Agents 0.17.3 also counted PartyServer `setName` on every chunk (gone in 0.34). Budgets are 0 calls per chunk unwatched and ≤1.01 with a viewer (measured ~1.002).
