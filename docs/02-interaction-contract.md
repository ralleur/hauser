# Interaction contract

Hauser treats immediate feedback and authoritative reconciliation as one
interaction contract. The interface responds locally first, but Home Assistant
remains the source of truth.

## Control pipeline

```text
pointer input
  → pressed feedback
  → optimistic intent
  → backend command
  → authoritative state update
  → confirmation or visible correction
```

The target budgets are:

| Stage | Target |
|---|---:|
| Pressed feedback visible | under 16 ms |
| Optimistic target state visible | under 50 ms |
| Backend command dispatched | under 100 ms |

These are application-side regression targets. They do not claim to measure
touch hardware, display scan-out or network latency end to end.

## Reconciliation outcomes

| Situation | Result |
|---|---|
| Server state matches the current intent | Remove the intent; keep the visible state |
| Server state contradicts the intent | Remove the intent; correct visibly to server truth |
| State changes without a local intent | Accept it as an external update |
| No authoritative update within 5 seconds | Keep the intent visible and mark it pending |
| Connection is unavailable | Preserve last known data, show the connection state and prevent false success |

A timeout does not trigger an automatic retry. The user can act again, and the
newest intent replaces the previous pending intent for that entity.

## Command deduplication

The command queue keeps at most one queued command per entity. If repeated
input arrives before dispatch, the newest command wins. Its matching optimistic
intent is also the state shown to the user.

This prevents rapid taps from producing a stale command sequence while still
allowing a later explicit action after a timeout.

## Control behavior

### Toggle and action button

1. Show pressed feedback immediately.
2. Apply the requested local state.
3. Dispatch the service call.
4. Reconcile with the authoritative update or show failure/pending state.

### Slider

1. Follow the pointer locally during the drag.
2. Dispatch the final value on release.
3. If the backend returns a different value, animate a short correction rather
   than jumping during the drag.

### Navigation

Navigation is local and never waits for a service. Transitions start from the
current screen state and use only composited properties.

## Accessibility requirements

- Interactive targets are at least 44 CSS pixels.
- Icon-only controls have accessible names.
- Critical meaning is not communicated by color alone.
- Keyboard focus remains visible.
- `prefers-reduced-motion` removes non-essential transition duration.
- Pending, error and unavailable are distinct states, not one generic spinner.

The pure reconciliation and queue logic lives in
`app/src/lib/adapter/overlay.ts` and `app/src/lib/adapter/command-queue.ts` and is
covered by unit tests.
