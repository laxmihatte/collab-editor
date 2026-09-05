# Visualization frames

A program visualizes itself by printing frames to stdout: one JSON object per
line, each describing the state of the data structure at that moment.

```python
import json
a = [5, 2, 9, 1]
print(json.dumps({"viz": "array", "data": a, "label": "start"}))
```

Any line that parses as JSON **and** has a `viz` key is a frame. Everything
else is ordinary output, so `print()` debugging still works alongside.

## Why this design

**stdout, rather than an API the program calls.** The sandbox has no network
access — it runs untrusted code, and that is the point. stdout is the one
channel that already exists, and it behaves identically in every language the
compiler supports. Any other design would mean punching a hole in the sandbox.

**One object per line, rather than one array.** A program that loops forever
and gets killed at the timeout still emitted valid frames up to that moment. A
single JSON array would be truncated mid-write and parse as nothing at all, so
you would lose every frame instead of the last one. Streaming formats degrade
gracefully; monolithic ones fail completely.

**A `viz` key, rather than a separate output stream.** stderr is already
carrying compiler and runtime errors, which are worth showing separately. A
marker key keeps frames and prints on one stream without either shadowing the
other.

## Array frames

For sorting and searching.

```json
{"viz": "array", "data": [5, 2, 9, 1], "highlight": [0, 1], "label": "compare"}
```

| Field | Required | Meaning |
| ----- | -------- | ------- |
| `viz` | yes | `"array"` |
| `data` | yes | The array as it stands right now |
| `highlight` | no | Indices under active comparison |
| `sorted` | no | Indices known to be in final position |
| `pointer` | no | `{"name": index}` for named cursors, e.g. `{"i": 3, "j": 5}` |
| `label` | no | One line describing this step |

## Graph frames

For traversal and shortest paths.

```json
{"viz": "graph",
 "nodes": ["A", "B", "C"],
 "edges": [["A", "B", 4], ["A", "C", 2]],
 "visited": ["A"],
 "frontier": ["B", "C"],
 "dist": {"A": 0, "B": 4, "C": 2},
 "label": "relax A→C"}
```

| Field | Required | Meaning |
| ----- | -------- | ------- |
| `viz` | yes | `"graph"` |
| `nodes` | first frame | Node ids |
| `edges` | first frame | `[from, to, weight?]` triples |
| `visited` | no | Nodes finalized |
| `frontier` | no | Nodes discovered but not finalized |
| `current` | no | The node being processed |
| `dist` | no | Best-known distance per node |
| `label` | no | One line describing this step |

Nodes and edges may be sent once in the first frame; later frames that omit
them inherit the previous structure, so a traversal only sends what changed.

## Limits

The sandbox truncates output at 64 KB, which is roughly 800 frames for a small
array. An algorithm on a large input should emit frames at meaningful moments
rather than on every loop iteration.
