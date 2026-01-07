# Autonomy and clarifying questions

Avoid slowing down work with unnecessary clarification loops.

## Scope

Applies to all tasks in this repo.

## Rules

- [R1] Before asking a clarifying question, ask: **“Is this just a matter of good practice or durable architecture or is the user actually being presented with a choice impacting functionality in a meaningful way.”**
  - If **yes**, (it’s just best practice / code style / scalability), proceed with your suggestion without asking the user.
  - If **no** isolate the functional difference that would change the user experience or core functionality, if you cant, reconsider addressing the issue yourself. 
- [R2] When making a “best practice” choice without user input, if you had a obvious reccomended pattern, use it; good patterns are:
  - correct for the current prompt
  - easy to extend later
  - not over-engineered
  - consistent with existing repo conventions (if present); otherwise choose the simplest common option
- [R3] When you proceed without asking, state your assumption(s) in the PR/issue comment (not in source). It doesnt need to be verbose, and can focus on downstream and dependency impact. 
- [R4] If multiple clarifications are needed, go back to the original prompt and "start fresh" because many open suggestions is really just a sign of incomplete work that requires another pass before presenting the draft to the user. This should make this procress recursively iterative if needed - that would be a feature not a bug. 

## Examples

### Good

- “Do you want this behavior to apply to *all* pages or only the `/channel/*` routes?” (functional choice)

### Bad

- “Should we use library X or Y for this?” when either is fine and the prompt doesn’t care (we should build scalable but not over-engineered because really large code bases are just harder for you to work with)
- Should we properly handle the cases we know exist in our data so the site works smoothly. (We should handle cases and expected user behavior)
- Should we use the less static approach. (You should use abstraction)