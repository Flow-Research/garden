# Agent SDK call budget

This test measures calls from a streamed run facet to its root Durable Object. It streams 5,000 text chunks and counts root `_cf_broadcastToSubAgent` calls, with zero viewers and with one viewer. The viewer case also checks that it receives every chunk in order.

Agents 0.17.3 also counted PartyServer `setName` on every chunk (gone in 0.34). The test allows up to 2.02 calls per chunk in both cases. After SDK fix #436, set the unwatched budget to 0 calls per chunk and the watched budget to at most 1.
