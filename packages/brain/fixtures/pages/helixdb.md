---
title: HelixDB Basics
author: sable
---

HelixDB is a graph database built for AI agents. It stores nodes and edges on top of an
object store, and it models queries as an operation tree that the server executes.

## Nodes and edges

A node carries labels and properties. Edges connect two nodes and can carry their own
properties. Every element has a stable id.

## Query model

Queries are sent as JSON describing operations. The server interprets the operation tree
and returns rows, which applications decode.
