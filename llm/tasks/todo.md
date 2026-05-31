# Rework Feature Implementation

Plan: `llm/tasks/rework-plan.md`
Design: `llm/tasks/rework-design.md`

## Tasks

- [x] Task 1: Database Migration — rework table, reworkId on jobOperation, views, RLS, completion trigger
- [x] Task 2: Trigger Rework Edge Function — path resolution, clone ops, wire DAG, trigger reschedule
- [x] Task 3: Upstream Operations Service + API Route — getUpstreamOperations(), rework-targets loader
- [x] Task 4: MES Trigger Rework Action Route — validator + action calling edge function
- [ ] Task 5: ReworkModal Component — modal with target picker, reason, quantity
- [x] Task 6: Wire ReworkModal into JobOperation — replace QuantityModal for rework
- [ ] Task 7: Manual Testing — verify full rework flow end-to-end
