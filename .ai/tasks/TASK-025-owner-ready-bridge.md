# TASK-025 — GitHub Owner Ready Transition Bridge

## Objective

Provide a fail-closed owner transition path for Draft PR -> Ready for review without relying on the broken GraphQL mutation path.

## Safety boundary

Allowed:
- validate a target Draft PR;
- validate exact head SHA;
- validate successful required CI evidence;
- perform only Ready for review transition.

Forbidden:
- merge;
- squash merge;
- push code;
- modify files;
- access secrets;
- publish externally.

## Required evidence

- repository identity
- PR number
- expected head SHA
- CI status
- transition audit record
